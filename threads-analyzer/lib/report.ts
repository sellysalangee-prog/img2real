import { DIMENSIONS, features, type AiTags, type Features } from "./tagging";
import type { Post } from "./types";

/** 같은 조건의 글이 이보다 적으면 조합을 보여주지 않습니다. */
const MIN_COMBO = 3;
const MIN_KEYWORD = 2;
/** 올린 지 이 시간이 안 된 글은 아직 조회수가 늘고 있어 집계에서 뺍니다. */
const MIN_AGE_HOURS = 24;

export type Condition = { dim: string; label: string; value: string };
export type Stat = {
  n: number;
  hits: number;
  rate: number;
  avgMultiple: number;
  /** 평균 조회수 (예전에 만든 리포트에는 없을 수 있습니다) */
  avgViews?: number;
  totalViews?: number;
};
export type Formula = Stat & {
  conditions: Condition[];
  /** 조건에는 없지만 이 글들이 모두 함께 가진 특징 */
  shared: Condition[];
  postIds: string[];
};

export type ReportPost = {
  id: string;
  text: string;
  permalink: string | null;
  timestamp: string;
  views: number;
  multiple: number;
  hit: boolean;
  features: Features;
};

export type ReportStats = {
  counts: { posts: number; analyzed: number; excludedRecent: number; untagged: number; hits: number };
  baseline: { median: number; hitViews: number; threshold: number };
  baseRate: number;
  formulas: Formula[];
  avoid: Formula[];
  dimensions: { key: string; label: string; values: (Stat & { value: string })[] }[];
  lifts: { label: string; value: string; rateWith: number; rateWithout: number; nWith: number }[];
  keywords: (Stat & { keyword: string })[];
  posts: ReportPost[];
};

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stat(items: ReportPost[]): Stat {
  const hits = items.filter((p) => p.hit).length;
  return {
    n: items.length,
    hits,
    rate: items.length ? hits / items.length : 0,
    avgMultiple: items.length ? items.reduce((a, p) => a + p.multiple, 0) / items.length : 0,
    avgViews: items.length ? items.reduce((a, p) => a + p.views, 0) / items.length : 0,
    totalViews: items.reduce((a, p) => a + p.views, 0),
  };
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  return items.flatMap((item, i) => combinations(items.slice(i + 1), size - 1).map((rest) => [item, ...rest]));
}

export function computeReport(allPosts: Post[], tags: Map<string, AiTags>, threshold: number, now = Date.now()): ReportStats {
  const recentCutoff = now - MIN_AGE_HOURS * 3600_000;
  const settled = allPosts.filter((p) => new Date(p.timestamp).getTime() <= recentCutoff);
  const tagged = settled.filter((p) => tags.has(p.id));

  const base = median(tagged.map((p) => p.metrics.views));
  const hitViews = Math.ceil(base * threshold);
  const posts: ReportPost[] = tagged.map((p) => {
    const views = p.metrics.views;
    return {
      id: p.id,
      text: p.text,
      permalink: p.permalink,
      timestamp: p.timestamp,
      views,
      multiple: base > 0 ? views / base : 0,
      hit: base > 0 && views >= hitViews,
      features: features(p, tags.get(p.id)!),
    };
  });

  const all = stat(posts);
  const baseRate = all.rate;

  // 항목별 표
  const dimensions = DIMENSIONS.map((d) => {
    const groups = new Map<string, ReportPost[]>();
    for (const p of posts) groups.set(p.features[d.key], [...(groups.get(p.features[d.key]) ?? []), p]);
    const values = [...groups].map(([value, items]) => ({ value, ...stat(items) })).sort((a, b) => b.rate - a.rate || b.n - a.n);
    return { key: d.key, label: d.label, values };
  });

  // 있을 때와 없을 때의 차이
  const lifts = dimensions
    .flatMap((d) =>
      d.values
        .filter((v) => v.n >= MIN_COMBO && posts.length - v.n >= MIN_COMBO)
        .map((v) => {
          const without = posts.filter((p) => p.features[d.key as keyof Features] !== v.value);
          return { label: d.label, value: v.value, rateWith: v.rate, rateWithout: stat(without).rate, nWith: v.n };
        }),
    )
    .filter((l) => l.rateWith > l.rateWithout)
    .sort((a, b) => b.rateWith - b.rateWithout - (a.rateWith - a.rateWithout))
    .slice(0, 6);

  // 키워드
  const kw = new Map<string, ReportPost[]>();
  for (const p of posts) for (const k of p.features.keywords) kw.set(k, [...(kw.get(k) ?? []), p]);
  const keywords = [...kw]
    .filter(([, items]) => items.length >= MIN_KEYWORD)
    .map(([keyword, items]) => ({ keyword, ...stat(items) }))
    .sort((a, b) => (b.avgViews ?? 0) - (a.avgViews ?? 0) || b.n - a.n)
    .slice(0, 40);

  // 조합 (2개, 3개 조건)
  const combos = new Map<string, { conditions: Condition[]; items: ReportPost[] }>();
  for (const p of posts) {
    const conds: Condition[] = DIMENSIONS.map((d) => ({ dim: d.key, label: d.label, value: p.features[d.key] }));
    for (const size of [2, 3]) {
      for (const c of combinations(conds, size)) {
        const key = c.map((x) => `${x.dim}=${x.value}`).join("|");
        const entry = combos.get(key) ?? { conditions: c, items: [] };
        entry.items.push(p);
        combos.set(key, entry);
      }
    }
  }

  // 표본이 적은 조합은 전체 평균 쪽으로 당겨서 순위를 매깁니다.
  const smoothed = (s: Stat) => (s.hits + baseRate * 2) / (s.n + 2);
  const candidates = [...combos.values()]
    .filter((c) => c.items.length >= MIN_COMBO)
    .map((c) => {
      const used = new Set(c.conditions.map((x) => x.dim));
      const shared = DIMENSIONS.filter((d) => !used.has(d.key))
        .filter((d) => c.items.every((p) => p.features[d.key] === c.items[0].features[d.key]))
        .map((d) => ({ dim: d.key, label: d.label, value: c.items[0].features[d.key] }));
      return { conditions: c.conditions, shared, postIds: c.items.map((p) => p.id), ...stat(c.items) };
    });

  // 같은 글 묶음을 가리키는 조합은 조건이 가장 적은 것 하나만 남깁니다.
  function dedupe(list: Formula[]): Formula[] {
    const seen = new Set<string>();
    return list.filter((f) => {
      const sig = [...f.postIds].sort().join(",");
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
  }

  const formulas = dedupe(
    candidates
      .filter((c) => c.hits >= 2 && c.rate > baseRate)
      .sort((a, b) => smoothed(b) - smoothed(a) || a.conditions.length - b.conditions.length || b.n - a.n),
  ).slice(0, 5);

  const avoid = dedupe(
    candidates
      .filter((c) => baseRate > 0 && c.n >= MIN_COMBO + 1 && c.rate <= baseRate * 0.3)
      .sort((a, b) => a.rate - b.rate || b.n - a.n || a.conditions.length - b.conditions.length),
  ).slice(0, 3);

  return {
    counts: {
      posts: allPosts.length,
      analyzed: posts.length,
      excludedRecent: allPosts.length - settled.length,
      untagged: settled.length - tagged.length,
      hits: all.hits,
    },
    baseline: { median: base, hitViews, threshold },
    baseRate,
    formulas,
    avoid,
    dimensions,
    lifts,
    keywords,
    posts: posts.sort((a, b) => b.multiple - a.multiple),
  };
}
