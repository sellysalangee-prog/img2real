import type postgres from "postgres";
import { z } from "zod";
import { askStructured } from "./claude";
import { computeInfluence, loadCommentRows, type Influence } from "./influence";
import { FACT_CATEGORIES } from "./memory";
import type { CheckResult, ConversationItem, Fact, InboxItem, PersonDetail, PersonSummary } from "./types";

type Sql = postgres.Sql;

type FactRow = {
  id: string;
  person_id: string;
  category: string;
  label: string;
  value: string;
  source_text: string | null;
  stated_at: Date | null;
  status: string;
  origin: string;
};

const FACT_COLUMNS = "id::text AS id, person_id::text AS person_id, category, label, value, source_text, stated_at, status, origin";

function toFact(r: FactRow): Fact {
  return {
    id: r.id,
    category: r.category as Fact["category"],
    label: r.label,
    value: r.value,
    sourceText: r.source_text,
    statedAt: r.stated_at?.toISOString() ?? null,
    status: r.status as Fact["status"],
    origin: r.origin as Fact["origin"],
  };
}

async function currentFacts(sql: Sql, personIds: string[]): Promise<Map<string, Fact[]>> {
  const map = new Map<string, Fact[]>();
  if (!personIds.length) return map;
  const rows = await sql<FactRow[]>`
    SELECT ${sql.unsafe(FACT_COLUMNS)} FROM facts
    WHERE person_id IN ${sql(personIds)} AND status = 'current'
    ORDER BY array_position(${FACT_CATEGORIES as unknown as string[]}::text[], category), id`;
  for (const r of rows) map.set(r.person_id, [...(map.get(r.person_id) ?? []), toFact(r)]);
  return map;
}

// ---------- 댓글함 ----------

export async function getInbox(sql: Sql, accountId: string, status: string): Promise<InboxItem[]> {
  const rows = await sql<
    {
      id: string;
      text: string;
      username: string | null;
      created_at: Date;
      permalink: string | null;
      status: string;
      post_text: string | null;
      post_permalink: string | null;
      parent_text: string | null;
      parent_is_mine: boolean | null;
      person_id: string | null;
      notes: string | null;
      labels: string[] | null;
      forgotten: boolean | null;
      comment_count: number;
      pending: boolean;
    }[]
  >`
    SELECT c.id, c.text, c.username, c.created_at, c.permalink, c.status,
      post.text AS post_text, post.permalink AS post_permalink,
      parent.text AS parent_text, parent.is_mine AS parent_is_mine,
      p.id::text AS person_id, p.notes, p.labels, p.forgotten,
      (SELECT count(*)::int FROM comments x WHERE x.account_id = c.account_id AND x.username = c.username AND NOT x.is_mine) AS comment_count,
      EXISTS (SELECT 1 FROM comments x WHERE x.account_id = c.account_id AND x.username = c.username AND NOT x.is_mine AND NOT x.extracted) AS pending
    FROM comments c
    LEFT JOIN posts post ON post.id = c.post_id
    LEFT JOIN comments parent ON parent.id = c.parent_id
    LEFT JOIN people p ON p.account_id = c.account_id AND p.username = c.username
    WHERE c.account_id = ${accountId} AND NOT c.is_mine AND c.status = ${status}
    ORDER BY c.created_at DESC
    LIMIT 60`;

  const facts = await currentFacts(sql, rows.filter((r) => r.person_id && !r.forgotten).map((r) => r.person_id!));
  const influence = computeInfluence(await loadCommentRows(sql, accountId));
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    createdAt: r.created_at.toISOString(),
    permalink: r.permalink,
    status: r.status as InboxItem["status"],
    post: { text: r.post_text ?? "", permalink: r.post_permalink },
    myParentText: r.parent_is_mine ? r.parent_text : null,
    person:
      r.username && r.person_id
        ? {
            id: r.person_id,
            username: r.username,
            notes: r.notes ?? "",
            labels: r.labels ?? [],
            influence: influence.get(r.username)?.type ?? "newcomer",
            forgotten: Boolean(r.forgotten),
            commentCount: r.comment_count,
            pending: r.pending,
            facts: facts.get(r.person_id) ?? [],
          }
        : null,
  }));
}

export async function setCommentStatus(sql: Sql, accountId: string, commentId: string, status: "open" | "dismissed"): Promise<boolean> {
  const res = await sql`UPDATE comments SET status = ${status} WHERE id = ${commentId} AND account_id = ${accountId} AND NOT is_mine`;
  return res.count > 0;
}

// ---------- 사람 ----------

export async function listPeople(sql: Sql, accountId: string, q: string): Promise<PersonSummary[]> {
  const like = `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
  const rows = await sql<
    {
      id: string;
      username: string;
      notes: string;
      labels: string[];
      last_seen_at: Date;
      comment_count: number;
      open_count: number;
      pending_count: number;
    }[]
  >`
    SELECT p.id::text AS id, p.username, p.notes, p.labels, p.last_seen_at,
      count(c.id) FILTER (WHERE NOT c.is_mine)::int AS comment_count,
      count(c.id) FILTER (WHERE NOT c.is_mine AND c.status = 'open')::int AS open_count,
      count(c.id) FILTER (WHERE NOT c.is_mine AND NOT c.extracted)::int AS pending_count
    FROM people p
    LEFT JOIN comments c ON c.account_id = p.account_id AND c.username = p.username
    WHERE p.account_id = ${accountId} AND NOT p.forgotten
      AND (${q} = '' OR p.username ILIKE ${like} OR p.notes ILIKE ${like} OR array_to_string(p.labels, ' ') ILIKE ${like}
           OR EXISTS (SELECT 1 FROM facts f WHERE f.person_id = p.id AND f.status = 'current' AND (f.value ILIKE ${like} OR f.label ILIKE ${like})))
    GROUP BY p.id
    ORDER BY p.last_seen_at DESC
    LIMIT 300`;
  const facts = await currentFacts(sql, rows.map((r) => r.id));
  const influence = computeInfluence(await loadCommentRows(sql, accountId));
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    notes: r.notes,
    labels: r.labels,
    influence: influence.get(r.username)?.type ?? "newcomer",
    lastSeenAt: r.last_seen_at.toISOString(),
    commentCount: r.comment_count,
    openCount: r.open_count,
    pending: r.pending_count > 0,
    facts: facts.get(r.id) ?? [],
  }));
}

async function ownedPerson(sql: Sql, accountId: string, personId: string) {
  if (!/^\d+$/.test(personId)) return null;
  const [p] = await sql<
    { id: string; username: string; notes: string; labels: string[]; first_seen_at: Date; last_seen_at: Date; forgotten: boolean }[]
  >`
    SELECT id::text AS id, username, notes, labels, first_seen_at, last_seen_at, forgotten FROM people
    WHERE id = ${personId} AND account_id = ${accountId}`;
  return p ?? null;
}

export async function getPerson(sql: Sql, accountId: string, personId: string): Promise<PersonDetail | null> {
  const p = await ownedPerson(sql, accountId, personId);
  if (!p || p.forgotten) return null;

  const facts = await sql<FactRow[]>`
    SELECT ${sql.unsafe(FACT_COLUMNS)} FROM facts WHERE person_id = ${p.id}
    ORDER BY status, array_position(${FACT_CATEGORIES as unknown as string[]}::text[], category), id`;

  // 그 사람의 댓글, 그 댓글에 단 내 답글, 그 사람이 답한 내 댓글을 시간순으로 모읍니다.
  const convo = await sql<{ id: string; text: string; created_at: Date; is_mine: boolean; post_id: string; post_text: string | null; permalink: string | null }[]>`
    WITH theirs AS (
      SELECT id, parent_id FROM comments WHERE account_id = ${accountId} AND username = ${p.username} AND NOT is_mine
    )
    SELECT c.id, c.text, c.created_at, c.is_mine, c.post_id, post.text AS post_text, c.permalink
    FROM comments c LEFT JOIN posts post ON post.id = c.post_id
    WHERE c.account_id = ${accountId} AND (
      c.id IN (SELECT id FROM theirs)
      OR (c.is_mine AND c.parent_id IN (SELECT id FROM theirs))
      OR (c.is_mine AND c.id IN (SELECT parent_id FROM theirs))
    )
    ORDER BY c.created_at
    LIMIT 400`;

  const conversation: ConversationItem[] = convo.map((c) => ({
    id: c.id,
    text: c.text,
    createdAt: c.created_at.toISOString(),
    isMine: c.is_mine,
    postId: c.post_id,
    postText: c.post_text ?? "",
    permalink: c.permalink,
  }));

  const influence: Influence = computeInfluence(await loadCommentRows(sql, accountId)).get(p.username) ?? {
    type: "newcomer",
    comments: 0,
    started: 0,
    pulledIn: 0,
    joinedOthers: 0,
    withMe: 0,
  };

  return {
    id: p.id,
    username: p.username,
    notes: p.notes,
    labels: p.labels,
    influence,
    firstSeenAt: p.first_seen_at.toISOString(),
    lastSeenAt: p.last_seen_at.toISOString(),
    facts: facts.map(toFact),
    conversation,
  };
}

export const PersonPatch = z.object({
  notes: z.string().max(2000).optional(),
  labels: z.array(z.string().trim().min(1).max(12)).max(8).optional(),
});

export async function updatePerson(sql: Sql, accountId: string, personId: string, patch: z.infer<typeof PersonPatch>): Promise<boolean> {
  const p = await ownedPerson(sql, accountId, personId);
  if (!p) return false;
  if (patch.notes !== undefined) await sql`UPDATE people SET notes = ${patch.notes} WHERE id = ${p.id}`;
  if (patch.labels !== undefined) await sql`UPDATE people SET labels = ${[...new Set(patch.labels)]}::text[] WHERE id = ${p.id}`;
  return true;
}

/** 인물 카드를 지우고, 앞으로 이 사람의 정보는 추출하지 않습니다. */
export async function forgetPerson(sql: Sql, accountId: string, personId: string): Promise<boolean> {
  const p = await ownedPerson(sql, accountId, personId);
  if (!p) return false;
  await sql.begin(async (tx) => {
    await tx`DELETE FROM facts WHERE person_id = ${p.id}`;
    await tx`UPDATE people SET notes = '', forgotten = true WHERE id = ${p.id}`;
  });
  return true;
}

export const FactInput = z.object({
  category: z.enum(FACT_CATEGORIES),
  label: z.string().trim().min(1).max(40),
  value: z.string().trim().min(1).max(300),
});

export async function addFact(sql: Sql, accountId: string, personId: string, input: z.infer<typeof FactInput>): Promise<Fact | null> {
  const p = await ownedPerson(sql, accountId, personId);
  if (!p || p.forgotten) return null;
  const [row] = await sql<FactRow[]>`
    INSERT INTO facts (person_id, category, label, value, origin, stated_at)
    VALUES (${p.id}, ${input.category}, ${input.label}, ${input.value}, 'user', now())
    RETURNING ${sql.unsafe(FACT_COLUMNS)}`;
  return toFact(row);
}

export const FactPatch = FactInput.partial().extend({ status: z.enum(["current", "past"]).optional() });

export async function updateFact(sql: Sql, accountId: string, factId: string, patch: z.infer<typeof FactPatch>): Promise<Fact | null> {
  if (!/^\d+$/.test(factId)) return null;
  const [row] = await sql<FactRow[]>`
    UPDATE facts f SET
      category = COALESCE(${patch.category ?? null}, f.category),
      label = COALESCE(${patch.label ?? null}, f.label),
      value = COALESCE(${patch.value ?? null}, f.value),
      status = COALESCE(${patch.status ?? null}, f.status),
      origin = CASE WHEN ${patch.value ?? null}::text IS NOT NULL THEN 'user' ELSE f.origin END,
      updated_at = now()
    FROM people p
    WHERE f.id = ${factId} AND p.id = f.person_id AND p.account_id = ${accountId}
    RETURNING ${sql.unsafe(FACT_COLUMNS.split(", ").map((c) => "f." + c).join(", "))}`;
  return row ? toFact(row) : null;
}

export async function deleteFact(sql: Sql, accountId: string, factId: string): Promise<boolean> {
  if (!/^\d+$/.test(factId)) return false;
  const res = await sql`DELETE FROM facts f USING people p WHERE f.id = ${factId} AND p.id = f.person_id AND p.account_id = ${accountId}`;
  return res.count > 0;
}

// ---------- 답글 실수 방지 검사 ----------

const CheckSchema = z.object({
  verdict: z.enum(["ok", "caution"]).describe("문제가 없으면 ok, 하나라도 고칠 점이 있으면 caution"),
  issues: z
    .array(
      z.object({
        quote: z.string().describe("초안에서 문제가 되는 부분 (그대로 인용)"),
        problem: z.string().describe("왜 문제인지, 근거가 된 인물 정보나 대화와 함께 한 문장으로"),
        suggestion: z.string().describe("바꿀 표현"),
      }),
    )
    .describe("발견한 문제. 없으면 빈 배열"),
  revised: z.string().describe("문제를 고친 전체 답글. 문제가 없으면 초안 그대로"),
});

const CHECK_SYSTEM = `당신은 Threads 크리에이터가 답글을 올리기 전에 실수를 막아 주는 비서입니다.
상대방의 인물 카드와 지난 대화를 근거로 답글 초안을 점검합니다.

찾아야 할 실수:
- 인물 정보와 어긋나는 말 (예: 해외로 이사한 사람에게 예전 동네 이야기, 자녀가 있다고 한 사람에게 "아직 싱글이시죠?")
- 상대가 이미 말해 준 것을 다시 묻는 질문
- 지난 정보(status=past)를 현재처럼 말하는 것
- 다른 사람과 헷갈린 것으로 보이는 내용
- 상대의 댓글 내용을 잘못 이해한 답
- 분명한 오탈자

지키는 원칙:
- 크리에이터의 말투와 길이는 최대한 그대로 둡니다. 실수만 고치고, 글을 새로 쓰지 않습니다.
- 근거 없이 트집 잡지 않습니다. 실수가 없으면 verdict는 ok, issues는 빈 배열, revised는 초안 그대로입니다.
- 모든 설명은 한국어로 짧게 씁니다.`;

export async function checkReply(sql: Sql, accountId: string, commentId: string, draft: string): Promise<CheckResult | null> {
  const [c] = await sql<
    { id: string; text: string; username: string | null; created_at: Date; post_text: string | null; parent_text: string | null; parent_is_mine: boolean | null }[]
  >`
    SELECT c.id, c.text, c.username, c.created_at, post.text AS post_text, parent.text AS parent_text, parent.is_mine AS parent_is_mine
    FROM comments c
    LEFT JOIN posts post ON post.id = c.post_id
    LEFT JOIN comments parent ON parent.id = c.parent_id
    WHERE c.id = ${commentId} AND c.account_id = ${accountId}`;
  if (!c) return null;

  const [person] = c.username
    ? await sql<{ id: string; notes: string; forgotten: boolean }[]>`
        SELECT id::text AS id, notes, forgotten FROM people WHERE account_id = ${accountId} AND username = ${c.username}`
    : [];
  const detail = person && !person.forgotten ? await getPerson(sql, accountId, person.id) : null;

  const factLines = detail?.facts.length
    ? detail.facts.map((f) => `- ${f.label}: ${f.value}${f.status === "past" ? " (지난 정보, 지금은 아님)" : ""}${f.statedAt ? ` [${f.statedAt.slice(0, 10)}]` : ""}`).join("\n")
    : "(기록된 정보 없음)";
  const history = detail?.conversation
    .filter((m) => m.id !== c.id)
    .slice(-20)
    .map((m) => `${m.isMine ? "나" : "상대"} (${m.createdAt.slice(0, 10)}): ${m.text.slice(0, 300)}`)
    .join("\n");

  const prompt = [
    `## 상대: ${c.username ? "@" + c.username : "(비공개 계정)"}`,
    "### 인물 카드",
    factLines,
    detail?.notes ? `### 크리에이터 메모\n${detail.notes}` : "",
    "### 지난 대화 (오래된 순)",
    history || "(없음)",
    "",
    "## 지금 답하려는 댓글",
    `원글: ${(c.post_text ?? "").slice(0, 300)}`,
    c.parent_is_mine && c.parent_text ? `(내 답글 "${c.parent_text.slice(0, 300)}"에 단 댓글)` : "",
    `댓글 (${c.created_at.toISOString().slice(0, 10)}): ${c.text}`,
    "",
    "## 답글 초안",
    draft,
  ]
    .filter(Boolean)
    .join("\n");

  return askStructured({ schema: CheckSchema, system: CHECK_SYSTEM, prompt, effort: "medium", maxTokens: 6000 });
}

export async function recordMyReply(sql: Sql, accountId: string, commentId: string, replyId: string, text: string): Promise<void> {
  const [c] = await sql<{ post_id: string }[]>`SELECT post_id FROM comments WHERE id = ${commentId} AND account_id = ${accountId}`;
  if (!c) return;
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO comments (id, account_id, post_id, parent_id, username, text, is_mine, created_at, status, extracted)
      VALUES (${replyId}, ${accountId}, ${c.post_id}, ${commentId}, NULL, ${text}, true, now(), 'replied', true)
      ON CONFLICT (id) DO NOTHING`;
    await tx`UPDATE comments SET status = 'replied' WHERE id = ${commentId} AND account_id = ${accountId}`;
  });
}
