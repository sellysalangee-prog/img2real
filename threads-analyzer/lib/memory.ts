import type postgres from "postgres";
import { z } from "zod";
import { askStructured } from "./claude";
import type { RawPostSummary, RawReply } from "./threads";

type Sql = postgres.Sql;

export const FACT_CATEGORIES = ["basic", "life", "interest", "recent", "other"] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<FactCategory, string> = {
  basic: "기본",
  life: "생활",
  interest: "관심사",
  recent: "근황",
  other: "기타",
};

/** 첫 수집 때 이보다 오래된 댓글은 댓글함에 넣지 않습니다. */
const INITIAL_INBOX_DAYS = 7;

// ---------- 수집한 댓글 저장 ----------

export async function ingestConversation(
  sql: Sql,
  accountId: string,
  myUsername: string,
  post: RawPostSummary,
  replies: RawReply[],
  firstSync: boolean,
): Promise<number> {
  await sql`
    INSERT INTO posts (id, account_id, text, permalink, created_at)
    VALUES (${post.id}, ${accountId}, ${post.text}, ${post.permalink}, ${new Date(post.timestamp)})
    ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, permalink = EXCLUDED.permalink`;

  if (!replies.length) return 0;

  const oldCutoff = Date.now() - INITIAL_INBOX_DAYS * 86400_000;
  const rows = replies.map((r) => {
    const isMine = r.is_reply_owned_by_me ?? r.username === myUsername;
    const createdAt = new Date(r.timestamp);
    const hidden = r.hide_status === "HIDDEN";
    const old = firstSync && createdAt.getTime() < oldCutoff;
    return {
      id: r.id,
      account_id: accountId,
      post_id: r.root_post?.id ?? post.id,
      parent_id: r.replied_to?.id ?? post.id,
      username: r.username ?? null,
      text: r.text ?? "",
      permalink: r.permalink ?? null,
      is_mine: isMine,
      created_at: createdAt,
      status: isMine ? "replied" : hidden || old ? "dismissed" : "open",
    };
  });

  const inserted = await sql<{ id: string; fresh: boolean }[]>`
    INSERT INTO comments ${sql(rows)}
    ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, permalink = EXCLUDED.permalink
    RETURNING id, (xmax = 0) AS fresh`;

  // 내가 답글을 단 댓글은 답변 완료로 바꿉니다.
  await sql`
    UPDATE comments SET status = 'replied'
    WHERE account_id = ${accountId} AND status <> 'replied' AND NOT is_mine
      AND id IN (SELECT parent_id FROM comments WHERE account_id = ${accountId} AND is_mine AND parent_id IS NOT NULL)`;

  // 아이디가 보이는 다른 사람 댓글만 인물로 만듭니다 (비공개 계정은 제외).
  const people = new Map<string, { first: Date; last: Date }>();
  for (const r of rows) {
    if (r.is_mine || !r.username) continue;
    const p = people.get(r.username);
    if (!p) people.set(r.username, { first: r.created_at, last: r.created_at });
    else {
      if (r.created_at < p.first) p.first = r.created_at;
      if (r.created_at > p.last) p.last = r.created_at;
    }
  }
  if (people.size) {
    const peopleRows = [...people].map(([username, p]) => ({ account_id: accountId, username, first_seen_at: p.first, last_seen_at: p.last }));
    await sql`
      INSERT INTO people ${sql(peopleRows)}
      ON CONFLICT (account_id, username) DO UPDATE SET
        first_seen_at = LEAST(people.first_seen_at, EXCLUDED.first_seen_at),
        last_seen_at = GREATEST(people.last_seen_at, EXCLUDED.last_seen_at)`;
  }

  return inserted.filter((r) => r.fresh).length;
}

// ---------- AI 정보 추출 ----------

const ExtractionSchema = z.object({
  newFacts: z
    .array(
      z.object({
        category: z.enum(FACT_CATEGORIES).describe("basic=기본(호칭·나이대·사는 곳·직업), life=생활(결혼·자녀·반려동물·해외 거주), interest=관심사, recent=근황, other=기타"),
        label: z.string().describe("짧은 항목명. 예: 사는 곳, 직업, 나이대, 결혼, 자녀, 반려동물, 관심사, 근황, 호칭"),
        value: z.string().describe("짧은 내용. 상대적인 시점은 댓글 날짜 기준 절대 시점으로 바꿔 적기"),
        sourceCommentId: z.string().describe("근거가 된 댓글 id"),
      }),
    )
    .describe("새로 알게 된 정보. 기존 정보와 같은 내용은 넣지 않습니다."),
  outdatedFactIds: z.array(z.number()).describe("새 댓글로 바뀌었거나 틀린 것으로 드러난 기존 정보의 id"),
});

const EXTRACT_SYSTEM = `당신은 Threads 크리에이터가 댓글로 만난 사람들을 기억하도록 돕는 비서입니다.
한 사람이 남긴 댓글을 읽고, 그 사람이 자기 자신에 대해 직접 밝힌 사실만 뽑아 인물 카드에 기록합니다.

반드시 지킬 규칙:
1. 댓글 작성자 본인에 대한 사실만 기록합니다. 크리에이터나 다른 사람에 대한 이야기는 기록하지 않습니다.
2. 문장에 분명하게 드러난 것만 기록합니다. 말투, 분위기, 정황으로 추측하지 않습니다. 애매하면 기록하지 않습니다.
3. 다음은 절대 기록하지 않습니다: 건강·질병·장애, 종교, 정치 성향, 성적 지향, 범죄 이력, 소득·부채 등 금융 정보, 전화번호·이메일·상세 주소, 주민번호 등 식별 번호.
4. 사는 곳은 도시나 나라 수준까지만 기록합니다.
5. 크리에이터 글에 대한 감상, 칭찬, 일회성 감정("오늘 피곤해요")은 기록하지 않습니다. 근황은 다음 대화에서 언급할 만한 일(이사, 이직, 출산, 시험, 여행 계획 등)만 기록합니다.
6. 이미 있는 정보와 같은 내용은 다시 넣지 않습니다. 새 댓글이 기존 정보를 바꾸면(예: 이사) 기존 정보 id를 outdatedFactIds에 넣고 새 정보를 newFacts에 넣습니다.
7. "다음 달", "3년째" 같은 상대적 표현은 댓글 날짜를 기준으로 "2026년 11월 예정", "2023년부터" 처럼 바꿔 적습니다.
8. 같은 종류의 정보에는 늘 같은 항목명을 씁니다.
모든 내용은 한국어로 짧게 씁니다. 기록할 것이 없으면 빈 배열을 돌려줍니다.`;

type PendingComment = {
  id: string;
  text: string;
  created_at: Date;
  parent_text: string | null;
  parent_is_mine: boolean | null;
  post_text: string | null;
};

/** 아직 정보 추출을 안 한 댓글이 있는 사람들 (최근 대화순) */
export async function peopleToExtract(sql: Sql, accountId: string, limit: number) {
  return sql<{ id: string; username: string }[]>`
    SELECT p.id::text AS id, p.username
    FROM people p
    JOIN comments c ON c.account_id = p.account_id AND c.username = p.username AND NOT c.is_mine AND NOT c.extracted
    WHERE p.account_id = ${accountId} AND NOT p.forgotten
    GROUP BY p.id
    ORDER BY max(c.created_at) DESC
    LIMIT ${limit}`;
}

export async function extractForPerson(sql: Sql, accountId: string, person: { id: string; username: string }): Promise<number> {
  const facts = await sql<{ id: string; category: string; label: string; value: string }[]>`
    SELECT id::text AS id, category, label, value FROM facts WHERE person_id = ${person.id} AND status = 'current' ORDER BY id`;

  const comments = await sql<PendingComment[]>`
    SELECT c.id, c.text, c.created_at, parent.text AS parent_text, parent.is_mine AS parent_is_mine, post.text AS post_text
    FROM comments c
    LEFT JOIN comments parent ON parent.id = c.parent_id
    LEFT JOIN posts post ON post.id = c.post_id
    WHERE c.account_id = ${accountId} AND c.username = ${person.username} AND NOT c.is_mine AND NOT c.extracted
    ORDER BY c.created_at
    LIMIT 30`;
  if (!comments.length) return 0;

  const withText = comments.filter((c) => c.text.trim());
  let added = 0;

  if (withText.length) {
    const prompt = [
      `인물: @${person.username}`,
      "",
      "## 이미 기록된 정보",
      facts.length ? facts.map((f) => `- [id ${f.id}] ${f.label}: ${f.value}`).join("\n") : "(없음)",
      "",
      "## 새 댓글 (오래된 순)",
      withText
        .map((c) => {
          const context = c.parent_is_mine && c.parent_text ? `(크리에이터의 답글 "${c.parent_text.slice(0, 200)}"에 대한 댓글)` : c.post_text ? `(글 "${c.post_text.slice(0, 120)}"에 단 댓글)` : "";
          return `[댓글 id ${c.id} · ${c.created_at.toISOString().slice(0, 10)}] ${context}\n${c.text}`;
        })
        .join("\n\n"),
    ].join("\n");

    const result = await askStructured({ schema: ExtractionSchema, system: EXTRACT_SYSTEM, prompt, effort: "low", maxTokens: 8000 });
    added = await applyExtraction(sql, person.id, result, comments);
  }

  await sql`UPDATE comments SET extracted = true WHERE id IN ${sql(comments.map((c) => c.id))}`;
  return added;
}

export async function applyExtraction(
  sql: Sql,
  personId: string,
  result: z.infer<typeof ExtractionSchema>,
  sources: { id: string; text: string; created_at: Date }[],
): Promise<number> {
  const byId = new Map(sources.map((c) => [c.id, c]));
  const rows = result.newFacts
    .filter((f) => f.label.trim() && f.value.trim())
    .map((f) => {
      const src = byId.get(f.sourceCommentId);
      return {
        person_id: personId,
        category: f.category,
        label: f.label.trim().slice(0, 40),
        value: f.value.trim().slice(0, 300),
        source_comment_id: src?.id ?? null,
        source_text: src?.text.slice(0, 500) ?? null,
        stated_at: src?.created_at ?? null,
      };
    });

  await sql.begin(async (tx) => {
    if (result.outdatedFactIds.length) {
      await tx`
        UPDATE facts SET status = 'past', updated_at = now()
        WHERE person_id = ${personId} AND status = 'current' AND id IN ${tx(result.outdatedFactIds)}`;
    }
    if (rows.length) {
      await tx`INSERT INTO facts ${tx(rows)}`;
    }
  });
  return rows.length;
}
