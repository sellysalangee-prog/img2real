import type postgres from "postgres";

type Sql = postgres.Sql;

/** 댓글 관계 분석에 쓰는 최소 정보 */
export type CommentRow = {
  id: string;
  post_id: string;
  parent_id: string | null;
  username: string | null;
  is_mine: boolean;
  created_at: Date;
  text: string;
  permalink: string | null;
};

export async function loadCommentRows(sql: Sql, accountId: string): Promise<CommentRow[]> {
  return sql<CommentRow[]>`
    SELECT id, post_id, parent_id, username, is_mine, created_at, text, permalink
    FROM comments WHERE account_id = ${accountId}`;
}

// ---------- 댓글 나무 ----------

type Forest = { byId: Map<string, CommentRow>; children: Map<string, CommentRow[]> };

function buildForest(rows: CommentRow[]): Forest {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const children = new Map<string, CommentRow[]>();
  for (const r of rows) {
    if (!r.parent_id || r.parent_id === r.id) continue;
    children.set(r.parent_id, [...(children.get(r.parent_id) ?? []), r]);
  }
  return { byId, children };
}

/** 댓글 아래로 이어진 모든 답글과 가장 깊은 단계 */
function descendants(forest: Forest, id: string): { items: CommentRow[]; depth: number } {
  const items: CommentRow[] = [];
  let depth = 0;
  const stack: [string, number][] = [[id, 0]];
  const seen = new Set<string>([id]);
  while (stack.length) {
    const [cur, d] = stack.pop()!;
    for (const child of forest.children.get(cur) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      items.push(child);
      depth = Math.max(depth, d + 1);
      stack.push([child.id, d + 1]);
    }
  }
  return { items, depth };
}

/** 이 댓글 때문에 대화에 들어온 다른 사람 (작성자와 나 제외) */
function pulledPeople(author: string, items: CommentRow[]): Set<string> {
  const set = new Set<string>();
  for (const r of items) if (!r.is_mine && r.username && r.username !== author) set.add(r.username);
  return set;
}

// ---------- 영향력 유형 (사람 탭) ----------

export const INFLUENCE_TYPES = {
  spark: { label: "🔥 불씨형", desc: "이 사람 댓글에 다른 사람들이 따라 들어와요" },
  connector: { label: "🔗 연결형", desc: "다른 사람 댓글에 자주 끼어들어 대화를 이어 줘요" },
  talker: { label: "💬 대화형", desc: "내 답글에 다시 답하며 나와 길게 주고받아요" },
  regular: { label: "👀 조용한 단골", desc: "자주 오지만 짧게 반응하고 가요" },
  newcomer: { label: "🌱 새로 온 사람", desc: "아직 댓글이 1~2개뿐이에요" },
} as const;
export type InfluenceType = keyof typeof INFLUENCE_TYPES;

export type Influence = {
  type: InfluenceType;
  comments: number;
  /** 다른 사람이 따라 들어온 댓글 수 */
  started: number;
  /** 이 사람 댓글로 대화에 들어온 사람 수 */
  pulledIn: number;
  /** 다른 사람(나 제외) 댓글에 단 답글 수 */
  joinedOthers: number;
  /** 내 답글에 다시 단 답글 수 */
  withMe: number;
};

export function computeInfluence(rows: CommentRow[]): Map<string, Influence> {
  const forest = buildForest(rows);
  const acc = new Map<string, { comments: number; started: number; pulled: Set<string>; joinedOthers: number; withMe: number }>();

  for (const r of rows) {
    if (r.is_mine || !r.username) continue;
    const a = acc.get(r.username) ?? { comments: 0, started: 0, pulled: new Set<string>(), joinedOthers: 0, withMe: 0 };
    a.comments++;
    const parent = r.parent_id ? forest.byId.get(r.parent_id) : undefined;
    if (parent?.is_mine) a.withMe++;
    else if (parent && parent.username && parent.username !== r.username) a.joinedOthers++;
    const pulled = pulledPeople(r.username, descendants(forest, r.id).items);
    if (pulled.size) a.started++;
    for (const u of pulled) a.pulled.add(u);
    acc.set(r.username, a);
  }

  const out = new Map<string, Influence>();
  for (const [username, a] of acc) {
    const pulledIn = a.pulled.size;
    const type: InfluenceType =
      pulledIn >= 3 || (a.started >= 2 && pulledIn >= 2)
        ? "spark"
        : a.joinedOthers >= 3
          ? "connector"
          : a.withMe >= 2
            ? "talker"
            : a.comments >= 3
              ? "regular"
              : "newcomer";
    out.set(username, { type, comments: a.comments, started: a.started, pulledIn, joinedOthers: a.joinedOthers, withMe: a.withMe });
  }
  return out;
}

// ---------- 댓글 트리거 (분석 탭) ----------

export type TriggerItem = {
  id: string;
  username: string;
  text: string;
  createdAt: string;
  permalink: string | null;
  postText: string;
  /** 아래로 이어진 답글 수 */
  replies: number;
  /** 이 댓글로 대화에 들어온 사람 수 */
  people: number;
  participants: string[];
  /** 답글이 이어진 단계 */
  depth: number;
  /** 이 댓글 전후 1시간의 원글 댓글 수 */
  before: number;
  after: number;
  /** 내가 처음 답하기까지 걸린 분 (답 안 했으면 null) */
  myReplyMinutes: number | null;
  score: number;
};

export type TriggerReport = {
  counts: { comments: number; people: number; conversations: number };
  triggers: TriggerItem[];
  connectors: { username: string; pulledIn: number; started: number }[];
  pairs: { a: string; b: string; exchanges: number }[];
};

const HOUR = 3600_000;

export function computeTriggers(rows: CommentRow[], postTexts: Map<string, string>, fromMs: number): TriggerReport {
  const forest = buildForest(rows);
  const inRange = rows.filter((r) => !r.is_mine && r.username && r.created_at.getTime() >= fromMs);

  const byPost = new Map<string, number[]>();
  for (const r of rows) if (!r.is_mine) byPost.set(r.post_id, [...(byPost.get(r.post_id) ?? []), r.created_at.getTime()]);

  const triggers: TriggerItem[] = [];
  const pulledByUser = new Map<string, { pulled: Set<string>; started: number }>();

  for (const c of inRange) {
    const { items, depth } = descendants(forest, c.id);
    const pulled = pulledPeople(c.username!, items);
    const u = pulledByUser.get(c.username!) ?? { pulled: new Set<string>(), started: 0 };
    if (pulled.size) u.started++;
    for (const p of pulled) u.pulled.add(p);
    pulledByUser.set(c.username!, u);
    if (!items.length) continue;

    const t = c.created_at.getTime();
    const times = byPost.get(c.post_id) ?? [];
    const before = times.filter((x) => x < t && x >= t - HOUR).length;
    const after = times.filter((x) => x > t && x <= t + HOUR).length;
    const myFirst = items
      .filter((r) => r.is_mine && r.parent_id === c.id)
      .map((r) => r.created_at.getTime())
      .sort((a, b) => a - b)[0];

    triggers.push({
      id: c.id,
      username: c.username!,
      text: c.text,
      createdAt: c.created_at.toISOString(),
      permalink: c.permalink,
      postText: postTexts.get(c.post_id) ?? "",
      replies: items.length,
      people: pulled.size,
      participants: [...pulled].slice(0, 8),
      depth,
      before,
      after,
      myReplyMinutes: myFirst ? Math.max(0, Math.round((myFirst - t) / 60000)) : null,
      score: items.length + pulled.size * 2 + depth,
    });
  }

  // 함께 대화한 사이: 서로의 댓글에 답한 횟수 (나는 제외)
  const pairCount = new Map<string, number>();
  for (const r of inRange) {
    const parent = r.parent_id ? forest.byId.get(r.parent_id) : undefined;
    if (!parent || parent.is_mine || !parent.username || parent.username === r.username) continue;
    const key = [r.username!, parent.username].sort().join("\u0000");
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
  }

  return {
    counts: {
      comments: inRange.length,
      people: new Set(inRange.map((r) => r.username)).size,
      conversations: triggers.length,
    },
    triggers: triggers.sort((a, b) => b.score - a.score).slice(0, 15),
    connectors: [...pulledByUser]
      .map(([username, v]) => ({ username, pulledIn: v.pulled.size, started: v.started }))
      .filter((c) => c.pulledIn > 0)
      .sort((a, b) => b.pulledIn - a.pulledIn || b.started - a.started)
      .slice(0, 10),
    pairs: [...pairCount]
      .map(([key, exchanges]) => {
        const [a, b] = key.split("\u0000");
        return { a, b, exchanges };
      })
      .sort((x, y) => y.exchanges - x.exchanges)
      .slice(0, 10),
  };
}
