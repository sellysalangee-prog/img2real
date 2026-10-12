import { db } from "./db";
import { extractForPerson, ingestConversation, peopleToExtract } from "./memory";
import type { Account } from "./session";
import { getConversation, getRecentPosts } from "./threads";

/** 댓글을 모을 최근 글 기간 */
const SYNC_DAYS = 30;
/** 한 번에 정보 추출할 최대 인원 (시간 초과 방지). 남은 인원은 다음 수집 때 처리합니다. */
const EXTRACT_PER_RUN = 12;

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

export type SyncResult = { posts: number; newComments: number; peopleUpdated: number; factsAdded: number; remaining: number; errors: string[] };

export async function syncAccount(account: Account): Promise<SyncResult> {
  const sql = await db();
  const firstSync = !account.lastSyncedAt;
  const errors: string[] = [];

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

  const people = await peopleToExtract(sql, account.id, EXTRACT_PER_RUN);
  const added = await mapLimit(people, 4, async (person) => {
    try {
      return await extractForPerson(sql, account.id, person);
    } catch (e) {
      errors.push(`@${person.username}: ${e instanceof Error ? e.message : String(e)}`);
      return 0;
    }
  });

  const [{ remaining }] = await sql<{ remaining: number }[]>`
    SELECT count(DISTINCT p.id)::int AS remaining FROM people p
    JOIN comments c ON c.account_id = p.account_id AND c.username = p.username AND NOT c.is_mine AND NOT c.extracted
    WHERE p.account_id = ${account.id} AND NOT p.forgotten`;
  await sql`UPDATE accounts SET last_synced_at = now() WHERE id = ${account.id}`;

  return {
    posts: posts.length,
    newComments: counts.reduce((a, b) => a + b, 0),
    peopleUpdated: people.length,
    factsAdded: added.reduce((a, b) => a + b, 0),
    remaining,
    errors: [...new Set(errors)].slice(0, 5),
  };
}
