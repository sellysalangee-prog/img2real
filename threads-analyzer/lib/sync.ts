import { AiError } from "./claude";
import { db } from "./db";
import { extractForPerson, ingestConversation, peopleToExtract } from "./memory";
import type { Account } from "./session";
import { getConversation, getRecentPosts } from "./threads";

/** 댓글을 모을 최근 글 기간 */
const SYNC_DAYS = 30;
/** 동시에 정리할 인원 */
const EXTRACT_CONCURRENCY = 6;
/** 한 번 호출에서 인물 정리에 쓸 최대 시간. 함수 제한 시간(300초) 안에 끝나도록 여유를 둡니다. */
const EXTRACT_BUDGET_MS = 200_000;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export type ExtractResult = { peopleUpdated: number; factsAdded: number; remaining: number; errors: string[] };
export type SyncResult = ExtractResult & { posts: number; newComments: number };

async function remainingPeople(accountId: string): Promise<number> {
  const sql = await db();
  const [{ remaining }] = await sql<{ remaining: number }[]>`
    SELECT count(DISTINCT p.id)::int AS remaining FROM people p
    JOIN comments c ON c.account_id = p.account_id AND c.username = p.username AND NOT c.is_mine AND NOT c.extracted
    WHERE p.account_id = ${accountId} AND NOT p.forgotten`;
  return remaining;
}

/** 정리 안 된 사람을 시간 예산 안에서 최대한 많이 정리합니다. 남은 사람은 다음 호출에서 이어서 처리합니다. */
export async function extractPending(accountId: string, budgetMs = EXTRACT_BUDGET_MS): Promise<ExtractResult> {
  const sql = await db();
  const started = Date.now();
  const errors: string[] = [];
  const failed = new Set<string>();
  let peopleUpdated = 0;
  let factsAdded = 0;

  while (Date.now() - started < budgetMs) {
    const batch = (await peopleToExtract(sql, accountId, EXTRACT_CONCURRENCY * 2 + failed.size)).filter((p) => !failed.has(p.id));
    if (!batch.length) break;

    let fatal = false;
    const added = await mapLimit(batch.slice(0, EXTRACT_CONCURRENCY * 2), EXTRACT_CONCURRENCY, async (person) => {
      if (fatal || Date.now() - started > budgetMs) return 0;
      try {
        const n = await extractForPerson(sql, accountId, person);
        peopleUpdated++;
        return n;
      } catch (e) {
        failed.add(person.id);
        const message = e instanceof Error ? e.message : String(e);
        errors.push(e instanceof AiError ? message : `@${person.username}: ${message}`);
        // 키 오류처럼 모두에게 똑같이 실패할 문제면 더 시도하지 않습니다.
        if (e instanceof AiError && /키|요청이 많|ANTHROPIC/.test(message)) fatal = true;
        return 0;
      }
    });
    factsAdded += added.reduce((a, b) => a + b, 0);
    if (fatal) break;
  }

  return { peopleUpdated, factsAdded, remaining: await remainingPeople(accountId), errors: [...new Set(errors)].slice(0, 5) };
}

export async function syncAccount(account: Account): Promise<SyncResult> {
  const sql = await db();
  const firstSync = !account.lastSyncedAt;
  const errors: string[] = [];
  const started = Date.now();

  const posts = await getRecentPosts(account.token, SYNC_DAYS);
  const counts = await mapLimit(posts, 5, async (post) => {
    try {
      const replies = await getConversation(account.token, post.id);
      return await ingestConversation(sql, account.id, account.username, post, replies, firstSync);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      return 0;
    }
  });
  await sql`UPDATE accounts SET last_synced_at = now() WHERE id = ${account.id}`;

  // 댓글 수집에 쓴 시간만큼 정리 시간을 줄입니다.
  const extracted = await extractPending(account.id, Math.max(EXTRACT_BUDGET_MS - (Date.now() - started), 30_000));

  return {
    ...extracted,
    posts: posts.length,
    newComments: counts.reduce((a, b) => a + b, 0),
    errors: [...new Set([...errors, ...extracted.errors])].slice(0, 5),
  };
}
