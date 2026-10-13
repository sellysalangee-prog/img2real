"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { HOUR_SLOTS, WEEKDAYS, type FeatureGroups, type HeatCell } from "@/lib/analysis";
import type { DailyPoint } from "@/lib/types";
import { num, pct } from "./format";

export function ViewsChart({ data }: { data: DailyPoint[] }) {
  if (data.length < 2) return <p className="muted empty">아직 일별 조회수 데이터가 없어요.</p>;
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis tickFormatter={(v: number) => num(v)} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
          <Tooltip
            formatter={(v) => [num(Number(v)), "조회수"]}
            labelFormatter={(d) => String(d)}
            contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, fontSize: 13 }}
          />
          <Area type="monotone" dataKey="views" stroke="var(--accent)" strokeWidth={2} fill="url(#viewsFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const SLOT_LABELS = HOUR_SLOTS.map((h, i) => `${h}~${HOUR_SLOTS[i + 1] ?? 24}시`);

export function Heatmap({ grid }: { grid: HeatCell[][] }) {
  const values = grid.flat().filter((c) => c.count > 0 && c.engagement !== null).map((c) => c.engagement!);
  const max = Math.max(...values, 0);
  const best = grid
    .flatMap((row, d) => row.map((c, s) => ({ c, d, s })))
    .filter((x) => x.c.count >= 2 && x.c.engagement !== null)
    .sort((a, b) => b.c.engagement! - a.c.engagement!)[0];

  return (
    <div>
      {best && (
        <p className="callout">
          가장 반응이 좋은 시간: <b>{WEEKDAYS[best.d]}요일 {SLOT_LABELS[best.s]}</b> (참여율 {pct(best.c.engagement)})
        </p>
      )}
      <div className="heatmap" role="table" aria-label="요일·시간대별 참여율">
        <div role="row" className="hm-row">
          <span />
          {WEEKDAYS.map((d) => (
            <span key={d} className="hm-head">
              {d}
            </span>
          ))}
        </div>
        {SLOT_LABELS.map((label, s) => (
          <div role="row" className="hm-row" key={label}>
            <span className="hm-label">{label}</span>
            {WEEKDAYS.map((d, w) => {
              const cell = grid[w][s];
              const level = cell.count && cell.engagement !== null && max > 0 ? cell.engagement / max : 0;
              return (
                <span
                  key={d}
                  role="cell"
                  className="hm-cell"
                  style={{ background: cell.count ? `color-mix(in oklab, var(--accent) ${Math.round(12 + level * 88)}%, var(--card))` : undefined }}
                  title={`${d} ${label} · 글 ${cell.count}개 · 참여율 ${pct(cell.engagement)} · 평균 조회 ${num(cell.avgViews)}`}
                >
                  {cell.count ? cell.count : ""}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <p className="tiny muted">칸이 진할수록 참여율이 높아요. 숫자는 글 개수예요. 한국 시간 기준.</p>
    </div>
  );
}

export function FeatureBars({ features }: { features: FeatureGroups }) {
  if (!features.length) return <p className="muted empty">비교할 만큼 글이 다양하지 않아요.</p>;
  return (
    <div className="features">
      {features.map((f) => {
        const max = Math.max(...f.groups.map((g) => g.engagement ?? 0), 0.0001);
        const top = [...f.groups].sort((a, b) => (b.engagement ?? 0) - (a.engagement ?? 0))[0];
        return (
          <section key={f.title} className="feature">
            <h4>{f.title}</h4>
            {f.groups.map((g) => (
              <div key={g.label} className="bar-row">
                <span className="bar-label">{g.label}</span>
                <span className="bar-track">
                  <span className={`bar-fill ${g === top ? "top" : ""}`} style={{ width: `${((g.engagement ?? 0) / max) * 100}%` }} />
                </span>
                <span className="bar-value">{pct(g.engagement)}</span>
                <span className="bar-count tiny muted">{g.count}개</span>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
