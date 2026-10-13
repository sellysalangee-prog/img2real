"use client";

import { useEffect, useMemo, useState } from "react";
import { featureGroups, filterByDays, rankPosts, summarize, engagementRate, timeStats } from "@/lib/analysis";
import type { DashboardData } from "@/lib/types";
import AiPanel from "./AiPanel";
import BestTime from "./BestTime";
import { FeatureBars, ViewsChart } from "./Charts";
import { date, num, pct } from "./format";
import PostCard from "./PostCard";
import Report from "./Report";
import Section from "./Section";
import Triggers from "./Triggers";

const PERIODS = [
  { days: 7, label: "7일" },
  { days: 30, label: "30일" },
  { days: 90, label: "90일" },
];
const TABS = ["리포트", "요약", "게시글", "인사이트", "트리거"] as const;
/** 글 지표(/api/data)가 필요한 탭 */
const NEEDS_DATA: readonly string[] = ["요약", "게시글", "인사이트"];
type Tab = (typeof TABS)[number];
type SortKey = "date" | "views" | "rate";

export default function Analytics({ onOpenPerson }: { onOpenPerson: (id: string) => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState<Tab>("리포트");
  const [sort, setSort] = useState<SortKey>("date");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/data");
      const body = await res.json();
      if (res.status === 401) {
        window.location.href = "/?error=" + encodeURIComponent(body.error ?? "다시 연결해 주세요.");
        return;
      }
      if (!res.ok) throw new Error(body.error ?? "데이터를 가져오지 못했어요.");
      setData(body as DashboardData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "데이터를 가져오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }

  // 글 지표는 필요한 탭을 처음 열 때 한 번만 불러옵니다.
  useEffect(() => {
    if (NEEDS_DATA.includes(tab) && !data && !loading && !error) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const view = useMemo(() => {
    if (!data) return null;
    const posts = filterByDays(data.posts, days);
    const prev = filterByDays(data.posts, days * 2).filter((p) => !posts.includes(p));
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    return {
      posts,
      summary: summarize(posts),
      prevSummary: prev.length ? summarize(prev) : null,
      ranked: rankPosts(posts),
      time: timeStats(posts),
      features: featureGroups(posts),
      daily: data.daily.filter((d) => d.date >= cutoff),
    };
  }, [data, days]);

  const sortedPosts = useMemo(() => {
    if (!view) return [];
    const list = [...view.posts];
    if (sort === "views") list.sort((a, b) => b.metrics.views - a.metrics.views);
    if (sort === "rate") list.sort((a, b) => (engagementRate(b) ?? -1) - (engagementRate(a) ?? -1));
    return list;
  }, [view, sort]);

  const periodLabel = PERIODS.find((p) => p.days === days)!.label;
  const range = `${date(new Date(Date.now() - days * 86400_000).toISOString()).split(" ").slice(0, 2).join(" ")} ~ 오늘`;
  const needsData = NEEDS_DATA.includes(tab);

  return (
    <div>
      <nav className="subtabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>

      <div className="controls" hidden={tab === "리포트"}>
        <div className="segmented grow" role="tablist" aria-label="기간">
          {PERIODS.map((p) => (
            <button key={p.days} role="tab" aria-selected={days === p.days} onClick={() => setDays(p.days)}>
              최근 {p.label}
            </button>
          ))}
        </div>
        {needsData && (
          <button className="btn ghost small" onClick={load} disabled={loading}>
            {loading ? "동기화 중…" : "새로고침"}
          </button>
        )}
      </div>

      <main className="content">
        {tab === "리포트" && <Report />}
        {tab === "트리거" && <Triggers days={days} onOpenPerson={onOpenPerson} />}

        {needsData && error && (
          <div className="card">
            <p className="error">{error}</p>
            <button className="btn primary small" onClick={load}>
              다시 시도
            </button>
          </div>
        )}

        {needsData && loading && !data && (
          <div className="card">
            <p className="muted">게시글과 지표를 모으는 중이에요. 글이 많으면 30초 정도 걸려요.</p>
            <div className="skeleton" />
          </div>
        )}

        {view && tab === "요약" && (
          <>
            <p className="tiny muted basis">
              {range} 동안 올린 원글 {view.summary.postCount}개 기준이에요. 답글과 예전 글이 받은 조회는 빠져 있어요.
            </p>
            <section className="kpis">
              <Kpi label="올린 글 조회수" value={num(view.summary.totalViews)} prev={view.prevSummary?.totalViews} current={view.summary.totalViews} />
              <Kpi label="평균 참여율" value={pct(view.summary.engagement)} prev={view.prevSummary?.engagement} current={view.summary.engagement} />
              <Kpi label="올린 글" value={`${view.summary.postCount}개`} prev={view.prevSummary?.postCount} current={view.summary.postCount} />
              <Kpi label="팔로워" value={num(data?.followers)} />
            </section>

            <section className="card">
              <h3>계정 전체 일별 조회수</h3>
              <p className="tiny muted">그날 내 계정 전체(예전 글, 답글 포함)가 받은 조회수예요.</p>
              <ViewsChart data={view.daily} />
            </section>

            <Section
              title={`반응 좋은 글 TOP ${view.ranked.best.length}`}
              defaultOpen
              summary={view.ranked.best[0] && <p className="tiny">1위: {view.ranked.best[0].text.slice(0, 40)}…</p>}
            >
              {view.ranked.best.length ? (
                view.ranked.best.map((p, i) => <PostCard key={p.id} post={p} rank={i + 1} />)
              ) : (
                <p className="muted empty">이 기간에는 순위를 매길 만한 글이 없어요.</p>
              )}
            </Section>

            {view.ranked.worst.length > 0 && (
              <Section title="아쉬웠던 글" summary={<p className="tiny muted">참여율이 낮았던 글 {view.ranked.worst.length}개</p>}>
                {view.ranked.worst.map((p) => (
                  <PostCard key={p.id} post={p} />
                ))}
              </Section>
            )}
          </>
        )}

        {view && tab === "게시글" && (
          <section className="card">
            <div className="card-head">
              <h3>게시글 {view.posts.length}개</h3>
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="정렬">
                <option value="date">최신순</option>
                <option value="views">조회수순</option>
                <option value="rate">참여율순</option>
              </select>
            </div>
            {sortedPosts.length ? sortedPosts.map((p) => <PostCard key={p.id} post={p} />) : <p className="muted empty">이 기간에 올린 글이 없어요.</p>}
          </section>
        )}

        {view && tab === "인사이트" && (
          <>
            <Section title="언제 올리면 좋을까" defaultOpen>
              <BestTime slots={view.time.slots} weekdays={view.time.weekdays} />
            </Section>
            <Section
              title="어떤 글이 반응이 좋을까"
              summary={<p className="tiny muted">글 길이, 사진·영상, 질문형, 이모지, 해시태그, 링크별 참여율 비교</p>}
            >
              <p className="tiny muted">유형별 평균 참여율이에요. 진한 막대가 가장 좋은 쪽이에요.</p>
              <FeatureBars features={view.features} />
            </Section>
            <AiPanel key={days} posts={view.posts} periodLabel={`최근 ${periodLabel}`} />
          </>
        )}

        {data && needsData && <p className="tiny muted footnote">마지막 동기화 {date(data.fetchedAt)} · 최근 글 {data.posts.length}개 기준</p>}
      </main>
    </div>
  );
}

function Kpi({ label, value, prev, current }: { label: string; value: string; prev?: number | null; current?: number | null }) {
  let delta: number | null = null;
  if (prev && current !== null && current !== undefined) delta = (current - prev) / prev;
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {delta !== null && (
        <span className={`kpi-delta ${delta >= 0 ? "up" : "down"}`}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta * 100).toFixed(0)}% <span className="muted">직전 기간 대비</span>
        </span>
      )}
    </div>
  );
}
