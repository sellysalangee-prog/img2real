"use client";

import { useEffect, useState } from "react";
import type { Formula, ReportStats } from "@/lib/report";
import type { Explanation, ReportAdvice } from "@/lib/report-ai";
import type { Features } from "@/lib/tagging";
import { api, errorMessage } from "./api";
import { date, num } from "./format";

type ModelKey = "opus" | "haiku";
const MODEL_INFO: Record<ModelKey, { name: string; note: string }> = {
  opus: { name: "Opus 5.5", note: "더 정확 · 글 150개 처음 분류에 약 3,000원" },
  haiku: { name: "Haiku 5.5", note: "가볍고 저렴 · 글 150개 처음 분류에 약 50원" },
};
const KRW = 1400;
const won = (usd: number) => `약 ${Math.max(1, Math.round(usd * KRW)).toLocaleString("ko-KR")}원`;
const pct = (r: number) => `${Math.round(r * 100)}%`;

type ReportData = {
  id: string;
  explanations?: Record<string, Explanation>;
  createdAt: string;
  days: number;
  tagModel: ModelKey;
  stats: ReportStats;
  advice: ReportAdvice | null;
  adviceError: string | null;
  aiCostUsd: number;
};
type TagResult = { total: number; tagged: number; remaining: number; costUsd: number };

const PERIODS = [
  { days: 30, label: "30일" },
  { days: 90, label: "90일" },
  { days: 0, label: "전체" },
] as const;
const THRESHOLDS = [2, 3, 5];

export default function Report() {
  const [report, setReport] = useState<ReportData | null>(null);
  const [tagModel, setTagModel] = useState<ModelKey>("opus");
  const [tagged, setTagged] = useState(0);
  const [days, setDays] = useState<0 | 30 | 90>(90);
  const [threshold, setThreshold] = useState(3);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api<{ report: ReportData | null; tagModel: ModelKey; tagged: number }>("/api/report")
      .then((r) => {
        setReport(r.report);
        setTagModel(r.tagModel);
        setTagged(r.tagged);
        if (r.report) {
          setDays(r.report.days as 0 | 30 | 90);
          setThreshold(r.report.stats.baseline.threshold);
        }
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoaded(true));
  }, []);

  async function build() {
    setError(null);
    let tagCost = 0;
    try {
      // 1) 분류 안 한 글이 없어질 때까지 나눠서 분류합니다.
      setProgress("글 목록을 가져오는 중…");
      for (let round = 0; round < 30; round++) {
        const r = await api<TagResult>("/api/report/tag", { method: "POST", json: { days } });
        tagCost += r.costUsd;
        setTagged(r.tagged);
        setProgress(`글 구조 분류 중 ${r.total - r.remaining}/${r.total}${tagCost ? ` · 지금까지 ${won(tagCost)}` : ""}`);
        if (r.remaining === 0) break;
      }
      // 2) 통계 계산과 AI 요약
      setProgress("확률 계산하고 요약하는 중…");
      const data = await api<ReportData>("/api/report", { method: "POST", json: { days, threshold } });
      setReport({ ...data, aiCostUsd: data.aiCostUsd + tagCost });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setProgress(null);
    }
  }

  return (
    <>
      <section className="card">
        <h3>글 구조 리포트</h3>
        <p className="tiny muted">
          글마다 첫 문장, 전개, 참여 유도, 감정, 주제를 분류해서 어떤 조합이 터졌는지 확률로 정리해요. 분류는 글마다 처음 한 번만 해요.
        </p>
        <div className="form-grid">
          <label className="tiny muted">기간</label>
          <div className="segmented" role="tablist" aria-label="기간">
            {PERIODS.map((p) => (
              <button key={p.days} role="tab" aria-selected={days === p.days} onClick={() => setDays(p.days)}>
                {p.label}
              </button>
            ))}
          </div>
          <label className="tiny muted" htmlFor="threshold">
            터짐 기준
          </label>
          <select id="threshold" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>
            {THRESHOLDS.map((t) => (
              <option key={t} value={t}>
                평소 조회수의 {t}배 이상
              </option>
            ))}
          </select>
        </div>
        <button className="btn primary full" onClick={build} disabled={progress !== null || !loaded}>
          {progress ? "만드는 중…" : "리포트 만들기"}
        </button>
        {progress && (
          <p className="notice" role="status">
            {progress}
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <p className="tiny muted center">
          분류된 글 {tagged}개 · 분류 모델 {MODEL_INFO[tagModel].name}
        </p>
      </section>

      {report && <ReportView report={report} />}

      <ModelSettings model={tagModel} onModel={setTagModel} onReset={() => setTagged(0)} />
    </>
  );
}

// ---------- 리포트 ----------

function conditionsText(f: Formula) {
  return f.conditions.map((c) => c.value).join(" · ");
}

function ReportView({ report }: { report: ReportData }) {
  const { stats, advice } = report;
  const [showPosts, setShowPosts] = useState(false);
  const byId = new Map(stats.posts.map((p) => [p.id, p]));

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h3>결과</h3>
          <span className="tiny muted">{date(report.createdAt)}</span>
        </div>
        <div className="report-meta">
          <div>
            <span className="kpi-label">분석한 글</span>
            <span className="kpi-value">{stats.counts.analyzed}개</span>
          </div>
          <div>
            <span className="kpi-label">터진 글</span>
            <span className="kpi-value">{stats.counts.hits}개</span>
          </div>
          <div>
            <span className="kpi-label">평균 확률</span>
            <span className="kpi-value">{pct(stats.baseRate)}</span>
          </div>
        </div>
        <p className="tiny muted">
          평소 조회수(중간값) {num(stats.baseline.median)}회의 {stats.baseline.threshold}배인 <b>{num(stats.baseline.hitViews)}회 이상</b>을 "터짐"으로 셌어요.
          {stats.counts.excludedRecent > 0 && ` 올린 지 하루가 안 된 글 ${stats.counts.excludedRecent}개는 뺐어요.`}
          {stats.counts.untagged > 0 && ` 분류되지 않은 글 ${stats.counts.untagged}개는 뺐어요.`}
        </p>
        {stats.counts.analyzed < 30 && <p className="tiny warn-text">글이 30개보다 적어서 확률이 우연일 수 있어요. 글이 쌓일수록 정확해져요.</p>}
      </section>

      {advice && (
        <section className="card">
          <h3>한눈에 보기</h3>
          <p className="ai-summary">{advice.summary}</p>
          <ul className="list good">
            {advice.insights.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      )}
      {report.adviceError && <p className="tiny muted">AI 요약은 만들지 못했어요: {report.adviceError}</p>}

      <section className="card">
        <h3>터지는 공식 TOP {stats.formulas.length || ""}</h3>
        {stats.formulas.length ? (
          stats.formulas.map((f, i) => (
            <FormulaCard key={i} rank={i + 1} f={f} byId={byId}>
              <Explain reportId={report.id} kind="formula" index={i} cached={report.explanations?.[`formula:${i}`]} />
            </FormulaCard>
          ))
        ) : (
          <p className="muted empty">같은 조건으로 2번 이상 터진 조합이 아직 없어요. 글이 더 쌓이거나 터짐 기준을 낮춰 보세요.</p>
        )}
      </section>

      {stats.avoid.length > 0 && (
        <section className="card">
          <h3>피해야 할 조합</h3>
          {stats.avoid.map((f, i) => (
            <div key={i} className="formula avoid">
              <p className="formula-cond">{conditionsText(f)}</p>
              <p className="formula-stat">
                {f.n}개 중 {f.hits}개 터짐 ({pct(f.rate)}) · 평소의 {f.avgMultiple.toFixed(1)}배
              </p>
              <Explain reportId={report.id} kind="avoid" index={i} cached={report.explanations?.[`avoid:${i}`]} />
            </div>
          ))}
        </section>
      )}

      {stats.lifts.length > 0 && (
        <section className="card">
          <h3>이 조건이면 확률이 올라가요</h3>
          <ul className="lifts">
            {stats.lifts.map((l) => (
              <li key={l.label + l.value}>
                <span>
                  <span className="muted">{l.label}</span> <b>{l.value}</b>
                </span>
                <span className="lift-num">
                  {pct(l.rateWith)} <span className="tiny muted">아니면 {pct(l.rateWithout)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {advice && (
        <section className="card">
          <h3>다음 글 제안</h3>
          <ol className="ideas">
            {advice.nextPosts.map((p) => (
              <li key={p.firstLine}>
                <p className="tiny muted">
                  {p.formula} · {p.when}
                </p>
                <b>“{p.firstLine}”</b>
                <p className="muted">{p.outline}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="card">
        <h3>항목별 터진 확률</h3>
        {stats.dimensions.map((d) => (
          <div key={d.key} className="feature">
            <h4>{d.label}</h4>
            {d.values.map((v) => (
              <div key={v.value} className="bar-row">
                <span className="bar-label">{v.value}</span>
                <span className="bar-track">
                  <span className="bar-fill top" style={{ width: `${v.rate * 100}%` }} />
                </span>
                <span className="bar-value">{pct(v.rate)}</span>
                <span className="bar-count tiny muted">
                  {v.hits}/{v.n}
                </span>
                {v.avgViews !== undefined && <span className="bar-views tiny muted">평균 조회 {num(v.avgViews)}회</span>}
              </div>
            ))}
          </div>
        ))}
      </section>

      {stats.keywords.length > 0 && (
        <section className="card">
          <KeywordTable keywords={stats.keywords} median={stats.baseline.median} />
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h3>글별 분류 결과</h3>
          <button className="link-btn tiny" onClick={() => setShowPosts((v) => !v)}>
            {showPosts ? "접기" : `${stats.posts.length}개 보기`}
          </button>
        </div>
        <p className="tiny muted">AI가 글을 어떻게 분류했는지 확인할 수 있어요.</p>
        {showPosts && stats.posts.map((p) => <TaggedPost key={p.id} p={p} />)}
      </section>

      <p className="tiny muted center">이번 리포트 AI 비용 {report.aiCostUsd > 0 ? won(report.aiCostUsd) : "없음"}</p>
    </>
  );
}

function FormulaCard({
  rank,
  f,
  byId,
  children,
}: {
  rank: number;
  f: Formula;
  byId: Map<string, ReportStats["posts"][number]>;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="formula">
      <div className="formula-head">
        <span className="rank">{rank}</span>
        <p className="formula-cond">{conditionsText(f)}</p>
      </div>
      <p className="formula-stat">
        <b className="big">{pct(f.rate)}</b> {f.n}개 중 {f.hits}개 터짐 · 평소의 {f.avgMultiple.toFixed(1)}배
      </p>
      {f.shared.length > 0 && <p className="tiny muted">함께 나타난 특징: {f.shared.map((c) => `${c.label} ${c.value}`).join(", ")}</p>}
      {children}
      <button className="link-btn tiny" onClick={() => setOpen((v) => !v)}>
        {open ? "글 접기" : "해당 글 보기"}
      </button>
      {open && f.postIds.length > 10 && <p className="tiny muted">터진 순으로 10개만 보여요 (전체 {f.postIds.length}개)</p>}
      {open &&
        [...f.postIds]
          .sort((a, b) => (byId.get(b)?.multiple ?? 0) - (byId.get(a)?.multiple ?? 0))
          .slice(0, 10)
          .map((id) => {
          const p = byId.get(id);
          return p ? (
            <p key={id} className="formula-post tiny">
              {p.hit ? "🔥" : "·"} {p.text.slice(0, 60) || "(본문 없음)"} <span className="muted">({p.multiple.toFixed(1)}배)</span>
            </p>
          ) : null;
        })}
    </div>
  );
}

type KeywordStat = ReportStats["keywords"][number];
type KeywordSort = "avgViews" | "totalViews" | "rate" | "n";

/** 키워드별 노출량과 터진 확률 */
function KeywordTable({ keywords, median }: { keywords: KeywordStat[]; median: number }) {
  const [sort, setSort] = useState<KeywordSort>("avgViews");
  const hasViews = keywords.some((k) => k.avgViews !== undefined);
  const sorted = [...keywords].sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0) || b.n - a.n);

  return (
    <>
      <div className="card-head">
        <h3>키워드별 노출량</h3>
        <select value={sort} onChange={(e) => setSort(e.target.value as KeywordSort)} aria-label="정렬">
          <option value="avgViews">평균 조회순</option>
          <option value="totalViews">총 조회순</option>
          <option value="rate">터진 확률순</option>
          <option value="n">글 수순</option>
        </select>
      </div>
      <p className="tiny muted">2번 이상 쓴 키워드만 보여요. 내 평소 조회수(중간값)는 {num(median)}회예요.</p>
      {!hasViews && <p className="tiny warn-text">예전에 만든 리포트라 조회수가 없어요. 리포트를 새로 만들면 보여요.</p>}
      <div className="table-wrap">
        <table className="kw-table">
          <thead>
            <tr>
              <th>키워드</th>
              <th>글</th>
              <th>평균 조회</th>
              <th>평소 대비</th>
              <th>터짐</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((k) => (
              <tr key={k.keyword}>
                <td className="kw-name">{k.keyword}</td>
                <td>{k.n}개</td>
                <td>
                  {num(k.avgViews)}
                  {k.totalViews !== undefined && <span className="tiny muted block">총 {num(k.totalViews)}</span>}
                </td>
                <td className={k.avgMultiple >= 1 ? "up" : "down"}>{k.avgMultiple.toFixed(1)}배</td>
                <td>
                  {pct(k.rate)}
                  <span className="tiny muted block">
                    {k.hits}/{k.n}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** 조합 하나의 원인 분석. 누를 때만 AI를 부르고, 한 번 분석한 결과는 저장돼 다시 볼 때 무료입니다. */
function Explain({ reportId, kind, index, cached }: { reportId: string; kind: "formula" | "avoid"; index: number; cached?: Explanation }) {
  const [result, setResult] = useState<Explanation | null>(cached ?? null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = kind === "avoid" ? "왜 안 터졌을까?" : "왜 터졌을까?";

  async function run() {
    if (result) return setOpen((v) => !v);
    setBusy(true);
    setError(null);
    try {
      setResult(await api<Explanation>("/api/report/explain", { method: "POST", json: { reportId, kind, index } }));
      setOpen(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="explain">
      <button className="btn ghost small explain-btn" onClick={run} disabled={busy}>
        {busy ? "분석 중…" : result ? (open ? "분석 접기" : `${label} 분석 보기`) : `${label} 분석하기 · 약 100원`}
      </button>
      {error && <p className="error tiny">{error}</p>}
      {result && open && (
        <div className={`explain-body ${kind}`}>
          <p className="explain-summary">{result.summary}</p>
          <h4>{kind === "avoid" ? "안 터진 이유" : "터진 이유"}</h4>
          <ol className="explain-list">
            {result.reasons.map((r) => (
              <li key={r.title}>
                <b>{r.title}</b>
                <p className="tiny muted">{r.evidence}</p>
              </li>
            ))}
          </ol>
          <h4>{kind === "avoid" ? "이렇게 바꿔 보세요" : "이걸 지키세요"}</h4>
          <ul className="list good">
            {result.actions.map((a) => (
              <li key={a.tip}>
                {a.tip}
                <p className="tiny muted">예: “{a.example}”</p>
              </li>
            ))}
          </ul>
          {result.rewrite && result.originalText && (
            <>
              <h4>다시 쓴다면</h4>
              <p className="tiny muted">원래 글</p>
              <p className="rewrite before">{result.originalText.slice(0, 300)}</p>
              <p className="tiny muted">바꾼 글</p>
              <p className="rewrite after">{result.rewrite.improved}</p>
            </>
          )}
          {result.costUsd > 0 && <p className="tiny muted">분석 비용 {won(result.costUsd)} · 다시 볼 때는 무료</p>}
        </div>
      )}
    </div>
  );
}

const TAG_FIELDS: { key: keyof Features; label: string }[] = [
  { key: "hook", label: "첫 문장" },
  { key: "structure", label: "전개" },
  { key: "cta", label: "유도" },
  { key: "emotion", label: "감정" },
  { key: "topic", label: "주제" },
  { key: "timeslot", label: "시간" },
  { key: "media", label: "형식" },
];

function TaggedPost({ p }: { p: ReportStats["posts"][number] }) {
  return (
    <div className="tagged">
      <div className="tagged-head">
        {p.hit && <span className="badge">터짐</span>}
        <span className="tiny muted">
          {date(p.timestamp)} · 조회 {num(p.views)} · 평소의 {p.multiple.toFixed(1)}배
        </span>
      </div>
      <p className="tagged-text">{p.text.slice(0, 120) || "(본문 없음)"}</p>
      <p className="tiny muted">
        {TAG_FIELDS.map((f) => `${f.label} ${p.features[f.key]}`).join(" · ")}
        {p.features.keywords.length > 0 && ` · #${p.features.keywords.join(" #")}`}
      </p>
    </div>
  );
}

// ---------- 모델 설정과 비교 ----------

type CompareResult = {
  posts: { id: string; text: string; opus: Features | null; haiku: Features | null }[];
  opus: { costUsd: number; costPer150: number };
  haiku: { costUsd: number; costPer150: number };
};

const COMPARE_FIELDS: { key: keyof Features; label: string }[] = [
  { key: "hook", label: "첫 문장" },
  { key: "structure", label: "전개" },
  { key: "cta", label: "참여 유도" },
  { key: "emotion", label: "감정" },
  { key: "topic", label: "주제" },
  { key: "keywords", label: "키워드" },
];

function ModelSettings({ model, onModel, onReset }: { model: ModelKey; onModel: (m: ModelKey) => void; onReset: () => void }) {
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [busy, setBusy] = useState<"compare" | "model" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(m: ModelKey) {
    setBusy("model");
    try {
      await api("/api/settings", { method: "PATCH", json: { tagModel: m } });
      onModel(m);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function runCompare() {
    setBusy("compare");
    setError(null);
    try {
      setCompare(await api<CompareResult>("/api/report/compare", { method: "POST" }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    if (!window.confirm("지금까지 분류한 결과를 모두 지우고, 다음 리포트 때 지금 모델로 처음부터 다시 분류할까요?")) return;
    setBusy("reset");
    try {
      await api("/api/report/tag", { method: "DELETE" });
      onReset();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const fmt = (v: Features[keyof Features] | undefined) => (Array.isArray(v) ? v.join(", ") : (v ?? "-"));

  return (
    <section className="card">
      <h3>분류 모델</h3>
      <div className="model-options" role="radiogroup" aria-label="분류 모델">
        {(Object.keys(MODEL_INFO) as ModelKey[]).map((m) => (
          <button key={m} role="radio" aria-checked={model === m} className="model-option" onClick={() => choose(m)} disabled={busy !== null}>
            <b>{MODEL_INFO[m].name}</b>
            <span className="tiny muted">{MODEL_INFO[m].note}</span>
          </button>
        ))}
      </div>
      <p className="tiny muted">모델을 바꿔도 이미 분류한 글은 그대로예요. 새 모델로 전부 다시 하려면 아래 "처음부터 다시 분류"를 누르세요.</p>

      <div className="reply-actions">
        <button className="btn ghost small" onClick={runCompare} disabled={busy !== null}>
          {busy === "compare" ? "비교하는 중…" : "모델 비교 테스트 (최근 글 8개)"}
        </button>
        <span className="grow" />
        <button className="link-btn tiny danger" onClick={reset} disabled={busy !== null}>
          처음부터 다시 분류
        </button>
      </div>
      {error && <p className="error tiny">{error}</p>}

      {compare && (
        <div className="compare">
          <table className="cost-table">
            <thead>
              <tr>
                <th />
                <th>Opus 5.5</th>
                <th>Haiku 5.5</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>이번 테스트 ({compare.posts.length}개)</td>
                <td>{won(compare.opus.costUsd)}</td>
                <td>{won(compare.haiku.costUsd)}</td>
              </tr>
              <tr>
                <td>글 150개 예상</td>
                <td>{won(compare.opus.costPer150)}</td>
                <td>{won(compare.haiku.costPer150)}</td>
              </tr>
            </tbody>
          </table>
          <p className="tiny muted">다르게 분류한 칸은 노란색으로 표시했어요. 어느 쪽이 내 글을 더 잘 이해했는지 보고 고르면 돼요.</p>
          {compare.posts.map((p) => (
            <div key={p.id} className="compare-post">
              <p className="tagged-text">{p.text.slice(0, 100)}</p>
              <table className="compare-table">
                <thead>
                  <tr>
                    <th />
                    <th>Opus</th>
                    <th>Haiku</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_FIELDS.map((f) => {
                    const a = fmt(p.opus?.[f.key]);
                    const b = fmt(p.haiku?.[f.key]);
                    return (
                      <tr key={f.key} className={a !== b ? "diff" : ""}>
                        <td>{f.label}</td>
                        <td>{a}</td>
                        <td>{b}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
