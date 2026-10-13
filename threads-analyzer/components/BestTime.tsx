"use client";

import { useState } from "react";
import type { TimeStat } from "@/lib/analysis";
import { num, pct } from "./format";

/** 이보다 글이 적은 시간대는 참고용으로만 보여줍니다. */
const MIN_POSTS = 3;
type Metric = "views" | "engagement";

function value(s: TimeStat, metric: Metric): number {
  return (metric === "views" ? s.medianViews : s.engagement) ?? 0;
}

function best(stats: TimeStat[], metric: Metric): TimeStat | null {
  return [...stats].filter((s) => s.count >= MIN_POSTS).sort((a, b) => value(b, metric) - value(a, metric))[0] ?? null;
}

function Bars({ stats, metric }: { stats: TimeStat[]; metric: Metric }) {
  const max = Math.max(...stats.map((s) => value(s, metric)), 1);
  const top = best(stats, metric);
  return (
    <div className="time-bars">
      {stats.map((s) => {
        const reliable = s.count >= MIN_POSTS;
        return (
          <div key={s.label} className={`time-row ${reliable ? "" : "weak"}`}>
            <span className="time-label">{s.label}</span>
            <span className="time-track">
              {s.count > 0 && <span className={`time-fill ${s === top ? "top" : ""}`} style={{ width: `${(value(s, metric) / max) * 100}%` }} />}
            </span>
            <span className="time-value">
              {s.count === 0 ? "-" : metric === "views" ? num(s.medianViews) : pct(s.engagement)}
              <span className="tiny muted"> · {s.count}개</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 언제 올리면 좋을까: 시간대·요일별 막대 그래프 */
export default function BestTime({ slots, weekdays }: { slots: TimeStat[]; weekdays: TimeStat[] }) {
  const [metric, setMetric] = useState<Metric>("views");
  const slot = best(slots, metric);
  const day = best(weekdays, metric);
  const metricName = metric === "views" ? "보통 조회수" : "참여율";

  return (
    <div>
      {slot || day ? (
        <p className="callout">
          {metric === "views" ? "가장 많이 보이는" : "가장 많이 반응하는"} 시간은 <b>{slot?.label ?? "-"}</b>
          {slot && <> ({metric === "views" ? `보통 ${num(slot.medianViews)}회` : `참여율 ${pct(slot.engagement)}`})</>}, 요일은{" "}
          <b>{day?.label ?? "-"}</b>
          {day && <> ({metric === "views" ? `보통 ${num(day.medianViews)}회` : `참여율 ${pct(day.engagement)}`})</>}
        </p>
      ) : (
        <p className="callout">같은 시간대에 올린 글이 3개 이상 쌓이면 추천해 줄게요.</p>
      )}

      <div className="segmented small-seg" role="tablist" aria-label="기준">
        <button role="tab" aria-selected={metric === "views"} onClick={() => setMetric("views")}>
          조회수 기준
        </button>
        <button role="tab" aria-selected={metric === "engagement"} onClick={() => setMetric("engagement")}>
          참여율 기준
        </button>
      </div>

      <h4>시간대별 {metricName}</h4>
      <Bars stats={slots} metric={metric} />
      <h4>요일별 {metricName}</h4>
      <Bars stats={weekdays} metric={metric} />

      <p className="tiny muted">
        {metric === "views"
          ? "막대가 길수록 그 시간에 올린 글이 보통 더 많이 조회됐어요. '보통'은 중간값이라 글 하나가 크게 터져도 크게 흔들리지 않아요."
          : "막대가 길수록 본 사람 중 좋아요·답글·리포스트·인용·공유를 누른 비율이 높아요."}{" "}
        글이 {MIN_POSTS}개보다 적은 칸은 흐리게 보여요. 한국 시간 기준이에요.
      </p>
    </div>
  );
}
