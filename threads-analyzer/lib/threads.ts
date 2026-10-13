import { env, REDIRECT_PATH } from "./env";
import type { DailyPoint, Post, PostMetrics, Profile, Reply } from "./types";

const GRAPH = "https://graph.threads.net";
const API = `${GRAPH}/v1.0`;
const SCOPES = [
  "threads_basic",
  "threads_manage_insights",
  "threads_read_replies",
  "threads_content_publish",
  "threads_manage_replies",
];
const POST_METRICS = ["views", "likes", "replies", "reposts", "quotes", "shares"] as const;
// Threads가 사용자 인사이트에 허용하는 가장 이른 시각 (2024-04-13)
const EARLIEST_INSIGHTS_TS = 1712991600;

export type TokenSet = { userId: string; accessToken: string; issuedAt: number; expiresAt: number };

export class ThreadsError extends Error {
  constructor(message: string, readonly status: number, readonly code?: number) {
    super(message);
  }

  /** 토큰이 만료되었거나 권한이 취소된 경우 */
  get isAuthError(): boolean {
    return this.status === 401 || this.code === 190;
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.error?.message ?? `Threads API 오류 (${res.status})`;
    throw new ThreadsError(message, res.status, body?.error?.code);
  }
  return body as T;
}

function withToken(path: string, token: string, params: Record<string, string | number> = {}): string {
  const url = new URL(path.startsWith("http") ? path : `${API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("access_token", token);
  return url.toString();
}

// ---------- 인증 ----------

export function authorizeUrl(state: string): string {
  const url = new URL("https://threads.net/oauth/authorize");
  url.searchParams.set("client_id", env.appId());
  url.searchParams.set("redirect_uri", env.appUrl() + REDIRECT_PATH);
  url.searchParams.set("scope", SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

/** 인가 코드 → 단기 토큰 → 장기 토큰(60일) */
export async function exchangeCode(code: string): Promise<TokenSet> {
  const short = await call<{ access_token: string; user_id: string | number }>(`${GRAPH}/oauth/access_token`, {
    method: "POST",
    body: new URLSearchParams({
      client_id: env.appId(),
      client_secret: env.appSecret(),
      grant_type: "authorization_code",
      redirect_uri: env.appUrl() + REDIRECT_PATH,
      code,
    }),
  });

  const long = await call<{ access_token: string; expires_in: number }>(
    withToken(`${GRAPH}/access_token`, short.access_token, {
      grant_type: "th_exchange_token",
      client_secret: env.appSecret(),
    }),
  );

  const now = Date.now();
  return {
    userId: String(short.user_id),
    accessToken: long.access_token,
    issuedAt: now,
    expiresAt: now + long.expires_in * 1000,
  };
}

/** 장기 토큰을 60일 연장합니다. 발급 후 24시간이 지나야 갱신할 수 있습니다. */
export async function refreshToken(token: string): Promise<Omit<TokenSet, "userId">> {
  const res = await call<{ access_token: string; expires_in: number }>(
    withToken(`${GRAPH}/refresh_access_token`, token, { grant_type: "th_refresh_token" }),
  );
  const now = Date.now();
  return { accessToken: res.access_token, issuedAt: now, expiresAt: now + res.expires_in * 1000 };
}

// ---------- 데이터 ----------

export async function getProfile(token: string): Promise<Profile> {
  const p = await call<{ id: string; username: string; name?: string; threads_profile_picture_url?: string; threads_biography?: string }>(
    withToken("/me", token, { fields: "id,username,name,threads_profile_picture_url,threads_biography" }),
  );
  return { id: p.id, username: p.username, name: p.name ?? p.username, picture: p.threads_profile_picture_url ?? null };
}

type RawPost = {
  id: string;
  text?: string;
  media_type: string;
  timestamp: string;
  permalink?: string;
  is_quote_post?: boolean;
};

type Paged<T> = { data: T[]; paging?: { next?: string } };

async function listPosts(token: string, max: number): Promise<RawPost[]> {
  const posts: RawPost[] = [];
  let url: string | undefined = withToken("/me/threads", token, {
    fields: "id,text,media_type,timestamp,permalink,is_quote_post",
    limit: Math.min(max, 100),
  });
  while (url && posts.length < max) {
    const page: Paged<RawPost> = await call<Paged<RawPost>>(url);
    posts.push(...page.data);
    url = page.data.length ? page.paging?.next : undefined;
  }
  // 다른 사람 글을 리포스트한 항목은 내 글이 아니므로 제외합니다.
  return posts.filter((p) => p.media_type !== "REPOST_FACADE").slice(0, max);
}

type InsightItem = {
  name: string;
  values?: { value: number; end_time?: string }[];
  total_value?: { value: number };
};

function metricValue(item: InsightItem | undefined): number {
  if (!item) return 0;
  if (item.total_value) return item.total_value.value ?? 0;
  return (item.values ?? []).reduce((sum, v) => sum + (Number(v.value) || 0), 0);
}

async function postMetrics(token: string, id: string): Promise<PostMetrics> {
  const empty: PostMetrics = { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0, shares: 0 };
  try {
    const res = await call<{ data: InsightItem[] }>(withToken(`/${id}/insights`, token, { metric: POST_METRICS.join(",") }));
    const byName = new Map(res.data.map((d) => [d.name, d]));
    return Object.fromEntries(POST_METRICS.map((m) => [m, metricValue(byName.get(m))])) as PostMetrics;
  } catch {
    return empty;
  }
}

/** 동시 요청 수를 제한해 순서대로 결과를 돌려줍니다. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

const NO_METRICS: PostMetrics = { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0, shares: 0 };

/** 지표 없이 글 목록만 가져옵니다 (지표 조회 호출을 아낍니다). */
export async function getPostList(token: string, max: number): Promise<Post[]> {
  return (await listPosts(token, max)).map((p) => ({
    id: p.id,
    text: p.text ?? "",
    mediaType: p.media_type,
    timestamp: p.timestamp,
    permalink: p.permalink ?? null,
    isQuote: Boolean(p.is_quote_post),
    metrics: NO_METRICS,
  }));
}

export async function getPosts(token: string, max: number): Promise<Post[]> {
  const raw = await listPosts(token, max);
  const metrics = await mapLimit(raw, 8, (p) => postMetrics(token, p.id));
  return raw.map((p, i) => ({
    id: p.id,
    text: p.text ?? "",
    mediaType: p.media_type,
    timestamp: p.timestamp,
    permalink: p.permalink ?? null,
    isQuote: Boolean(p.is_quote_post),
    metrics: metrics[i],
  }));
}

/** 최근 days일 동안의 일별 조회수와 현재 팔로워 수 */
export async function getAccountInsights(token: string, days: number): Promise<{ daily: DailyPoint[]; followers: number | null }> {
  const until = Math.floor(Date.now() / 1000);
  const since = Math.max(until - days * 86400, EARLIEST_INSIGHTS_TS);

  const [views, followers] = await Promise.all([
    call<{ data: InsightItem[] }>(withToken("/me/threads_insights", token, { metric: "views", since, until })).catch(() => null),
    call<{ data: InsightItem[] }>(withToken("/me/threads_insights", token, { metric: "followers_count" })).catch(() => null),
  ]);

  const daily: DailyPoint[] = (views?.data.find((d) => d.name === "views")?.values ?? [])
    .filter((v) => v.end_time)
    .map((v) => ({ date: v.end_time!.slice(0, 10), views: Number(v.value) || 0 }));

  const followerItem = followers?.data.find((d) => d.name === "followers_count");
  return { daily, followers: followerItem ? metricValue(followerItem) : null };
}

export async function getReplies(token: string, postId: string, limit = 25): Promise<Reply[]> {
  try {
    const res = await call<Paged<{ id: string; text?: string; username?: string; timestamp: string }>>(
      withToken(`/${postId}/replies`, token, { fields: "id,text,username,timestamp", limit }),
    );
    return res.data.filter((r) => r.text).map((r) => ({ postId, text: r.text!, username: r.username ?? "" }));
  } catch {
    return [];
  }
}

// ---------- 댓글 수집과 답글 게시 ----------

export type RawPostSummary = { id: string; text: string; permalink: string | null; timestamp: string };

/** 최근 days일 안에 올린 내 글 (리포스트 제외) */
export async function getRecentPosts(token: string, days: number, max = 50): Promise<RawPostSummary[]> {
  const since = Math.floor((Date.now() - days * 86400_000) / 1000);
  const out: RawPostSummary[] = [];
  let url: string | undefined = withToken("/me/threads", token, {
    fields: "id,text,media_type,timestamp,permalink",
    since,
    limit: Math.min(max, 100),
  });
  while (url && out.length < max) {
    const page: Paged<RawPost> = await call<Paged<RawPost>>(url);
    for (const p of page.data) {
      if (p.media_type !== "REPOST_FACADE") out.push({ id: p.id, text: p.text ?? "", permalink: p.permalink ?? null, timestamp: p.timestamp });
    }
    url = page.data.length ? page.paging?.next : undefined;
  }
  return out.slice(0, max);
}

export type RawReply = {
  id: string;
  text?: string;
  username?: string;
  timestamp: string;
  permalink?: string;
  root_post?: { id: string };
  replied_to?: { id: string };
  is_reply_owned_by_me?: boolean;
  hide_status?: string;
};

/** 글에 달린 모든 댓글과 대댓글 (내 답글 포함) */
export async function getConversation(token: string, postId: string, max = 300): Promise<RawReply[]> {
  const out: RawReply[] = [];
  let url: string | undefined = withToken(`/${postId}/conversation`, token, {
    fields: "id,text,username,timestamp,permalink,root_post,replied_to,is_reply_owned_by_me,hide_status",
    reverse: "false",
    limit: 100,
  });
  while (url && out.length < max) {
    const page: Paged<RawReply> = await call<Paged<RawReply>>(url);
    out.push(...page.data);
    url = page.data.length ? page.paging?.next : undefined;
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 댓글에 답글을 올립니다. 컨테이너를 만든 뒤 게시하며, 처리 중이면 잠시 후 다시 시도합니다. */
export async function publishReply(token: string, replyToId: string, text: string): Promise<string> {
  const container = await call<{ id: string }>(withToken("/me/threads", token, { media_type: "TEXT", text, reply_to_id: replyToId }), {
    method: "POST",
  });
  let lastError: unknown;
  for (const wait of [0, 2000, 5000, 10000]) {
    if (wait) await sleep(wait);
    try {
      const published = await call<{ id: string }>(withToken("/me/threads_publish", token, { creation_id: container.id }), { method: "POST" });
      return published.id;
    } catch (e) {
      lastError = e;
      if (e instanceof ThreadsError && e.isAuthError) break;
    }
  }
  throw lastError;
}
