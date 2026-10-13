import type { Post } from "./types";

export const TIME_ZONE = "Asia/Seoul";
export const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];
/** 히트맵 시간대 구간 (시작 시각) */
export const HOUR_SLOTS = [0, 6, 9, 12, 15, 18, 21];

export function interactions(p: Post): number {
  const m = p.metrics;
  return m.likes + m.replies + m.reposts + m.quotes + m.shares;
}

/** 참여율 = 반응 수 ÷ 조회수. 조회수가 없으면 null */
export function engagementRate(p: Post): number | null {
  return p.metrics.views > 0 ? interactions(p) / p.metrics.views : null;
}

export function filterByDays(posts: Post[], days: number): Post[] {
  const from = Date.now() - days * 86400_000;
  return posts.filter((p) => new Date(p.timestamp).getTime() >= from);
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function avg(values: number[]): number | null {
  return values.length ? sum(values) / values.length : null;
}

export type Summary = {
  postCount: number;
  totalViews: number;
  totalInteractions: number;
  avgViews: number | null;
  /** 전체 반응 ÷ 전체 조회수 (조회수가 큰 글에 가중) */
  engagement: number | null;
};

export function summarize(posts: Post[]): Summary {
  const totalViews = sum(posts.map((p) => p.metrics.views));
  const totalInteractions = sum(posts.map(interactions));
  return {
    postCount: posts.length,
    totalViews,
    totalInteractions,
    avgViews: avg(posts.map((p) => p.metrics.views)),
    engagement: totalViews > 0 ? totalInteractions / totalViews : null,
  };
}

/** 조회수가 너무 적은 글은 참여율이 왜곡되므로 순위에서 뺍니다. */
function rankable(posts: Post[]): Post[] {
  const median = [...posts.map((p) => p.metrics.views)].sort((a, b) => a - b)[Math.floor(posts.length / 2)] ?? 0;
  const minViews = Math.max(30, median * 0.2);
  return posts.filter((p) => p.metrics.views >= minViews);
}

export function rankPosts(posts: Post[], n = 5): { best: Post[]; worst: Post[] } {
  const sorted = rankable(posts).sort((a, b) => (engagementRate(b) ?? 0) - (engagementRate(a) ?? 0));
  return { best: sorted.slice(0, n), worst: sorted.slice(-n).reverse().filter((p) => !sorted.slice(0, n).includes(p)) };
}

function localParts(iso: string): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(
    new Date(iso),
  );
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  return { weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wd), hour };
}

function slotOf(hour: number): number {
  let idx = 0;
  HOUR_SLOTS.forEach((start, i) => {
    if (hour >= start) idx = i;
  });
  return idx;
}

export type HeatCell = { count: number; avgViews: number | null; engagement: number | null };

/** [요일][시간대] 별 평균 성과 */
export function heatmap(posts: Post[]): HeatCell[][] {
  const grid: Post[][][] = WEEKDAYS.map(() => HOUR_SLOTS.map(() => []));
  for (const p of posts) {
    const { weekday, hour } = localParts(p.timestamp);
    grid[weekday]?.[slotOf(hour)]?.push(p);
  }
  return grid.map((row) =>
    row.map((cell) => {
      const s = summarize(cell);
      return { count: cell.length, avgViews: s.avgViews, engagement: s.engagement };
    }),
  );
}

export type Group = { label: string; count: number; avgViews: number | null; engagement: number | null };

function groupBy(posts: Post[], labels: string[], pick: (p: Post) => string): Group[] {
  return labels
    .map((label) => {
      const items = posts.filter((p) => pick(p) === label);
      const s = summarize(items);
      return { label, count: items.length, avgViews: s.avgViews, engagement: s.engagement };
    })
    .filter((g) => g.count > 0);
}

const MEDIA_LABELS: Record<string, string> = {
  TEXT_POST: "텍스트",
  IMAGE: "이미지",
  VIDEO: "영상",
  CAROUSEL_ALBUM: "캐러셀",
  AUDIO: "오디오",
};

const EMOJI = /\p{Extended_Pictographic}/u;
const HASHTAG = /(^|\s)#[^\s#]+/;
const LINK = /https?:\/\//;

export type FeatureGroups = { title: string; groups: Group[] }[];

export function featureGroups(posts: Post[]): FeatureGroups {
  const lengthLabel = (p: Post) => {
    const n = [...p.text].length;
    if (n < 50) return "짧음 (~50자)";
    if (n < 150) return "보통 (50~150자)";
    if (n < 300) return "김 (150~300자)";
    return "아주 김 (300자~)";
  };
  const yesNo = (test: (p: Post) => boolean) => (p: Post) => (test(p) ? "있음" : "없음");

  return [
    { title: "글 길이", groups: groupBy(posts, ["짧음 (~50자)", "보통 (50~150자)", "김 (150~300자)", "아주 김 (300자~)"], lengthLabel) },
    { title: "게시물 유형", groups: groupBy(posts, Object.values(MEDIA_LABELS), (p) => MEDIA_LABELS[p.mediaType] ?? "텍스트") },
    { title: "질문으로 끝나는 글", groups: groupBy(posts, ["있음", "없음"], yesNo((p) => /[?？]\s*$/.test(p.text.trim()))) },
    { title: "이모지", groups: groupBy(posts, ["있음", "없음"], yesNo((p) => EMOJI.test(p.text))) },
    { title: "해시태그(주제 태그)", groups: groupBy(posts, ["있음", "없음"], yesNo((p) => HASHTAG.test(p.text))) },
    { title: "외부 링크", groups: groupBy(posts, ["있음", "없음"], yesNo((p) => LINK.test(p.text))) },
  ].filter((f) => f.groups.length > 1);
}

export function mediaLabel(type: string): string {
  return MEDIA_LABELS[type] ?? type;
}

// ---------- 올리는 시간별 성과 (막대 그래프용) ----------

export type TimeStat = {
  label: string;
  count: number;
  /** 보통 조회수 (중간값: 아주 잘 되거나 안 된 글 하나에 휘둘리지 않는 값) */
  medianViews: number | null;
  maxViews: number | null;
  engagement: number | null;
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function timeStat(label: string, items: Post[]): TimeStat {
  const views = items.map((p) => p.metrics.views);
  return {
    label,
    count: items.length,
    medianViews: median(views),
    maxViews: views.length ? Math.max(...views) : null,
    engagement: summarize(items).engagement,
  };
}

export const SLOT_LABELS = HOUR_SLOTS.map((h, i) => `${h}~${HOUR_SLOTS[i + 1] ?? 24}시`);

/** 시간대별, 요일별 성과 (한국 시간) */
export function timeStats(posts: Post[]): { slots: TimeStat[]; weekdays: TimeStat[] } {
  const bySlot: Post[][] = HOUR_SLOTS.map(() => []);
  const byDay: Post[][] = WEEKDAYS.map(() => []);
  for (const p of posts) {
    const { weekday, hour } = localParts(p.timestamp);
    bySlot[slotOf(hour)]?.push(p);
    byDay[weekday]?.push(p);
  }
  return {
    slots: SLOT_LABELS.map((label, i) => timeStat(label, bySlot[i])),
    weekdays: WEEKDAYS.map((d, i) => timeStat(`${d}요일`, byDay[i])),
  };
}
