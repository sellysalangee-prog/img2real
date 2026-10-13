"use client";

import { useEffect, useState } from "react";
import type { Formula, ReportStats } from "@/lib/report";
import type { Explanation, ReportAdvice } from "@/lib/report-ai";
import type { Features } from "@/lib/tagging";
import { buildCsv, buildMarkdown, CLAUDE_PROMPT, downloadText } from "@/lib/report-export";
import { conditionPhrase, formulaResult, formulaSentence } from "@/lib/report-text";
import { api, errorMessage } from "./api";
import { date, num } from "./format";
import Section from "./Section";

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

type Previous = { createdAt: string; baseRate: number; hits: number; analyzed: number } | null;

export default function Report() {
  const [report, setReport] = useState<ReportData | null>(null);
  const [previous, setPrevious] = useState<Previous>(null);
  const [username, setUsername] = useState("");
  const [tagModel, setTagModel] = useState<ModelKey>("opus");
  const [tagged, setTagged] = useState(0);
  const [days, setDays] = useState<0 | 30 | 90>(30);
  const [threshold, setThreshold] = useState(3);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api<{ report: ReportData | null; previous: Previous; username: string; tagModel: ModelKey; tagged: number }>("/api/report")
      .then((r) => {
        setReport(r.report);
        setPrevious(r.previous);
        setUsername(r.username);
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
      if (report) {
        setPrevious({ createdAt: report.createdAt, baseRate: report.stats.baseRate, hits: report.stats.counts.hits, analyzed: report.stats.counts.analyzed });
      }
      setReport({ ...data, aiCostUsd: data.aiCostUsd + tagCost });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setProgress(null);
    }
  }

  const periodLabel = PERIODS.find((p) => p.days === days)?.label ?? "";

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h3>스레드 성적표</h3>
          {report && <span className="tiny muted">{date(report.createdAt)}</span>}
        </div>
        <p className="tiny muted">
          {report
            ? `${report.days ? `최근 ${report.days}일` : "전체 기간"} 글을 분석한 결과예요. 새 글이 쌓이면 다시 만들어 보세요.`
            : "내 글의 구조를 분석해서 무엇이 터졌는지, 왜 터졌는지, 다음엔 뭘 쓸지 한 장으로 정리해요."}
        </p>
        <button className="btn primary full" onClick={build} disabled={progress !== null || !loaded}>
          {progress ? "만드는 중…" : report ? `성적표 새로 만들기 (최근 ${periodLabel})` : `성적표 만들기 (최근 ${periodLabel})`}
        </button>
        {progress && (
          <p className="notice" role="status">
            {progress}
          </p>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      {report && <ReportView report={report} previous={previous} username={username} />}

      <Section title="⚙️ 설정" summary={<p className="tiny muted">기간 {periodLabel} · 평소의 {threshold}배 이상이면 터짐 · 분류 모델 {MODEL_INFO[tagModel].name} · 분류된 글 {tagged}개</p>}>
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
        <p className="tiny muted">설정을 바꾼 뒤 성적표를 새로 만들면 반영돼요.</p>
        <ModelSettings model={tagModel} onModel={setTagModel} onReset={() => setTagged(0)} />
      </Section>
    </>
  );
}

// ---------- 성적표 ----------

function ReportView({ report, previous, username }: { report: ReportData; previous: Previous; username: string }) {
  const { stats, advice } = report;
  const byId = new Map(stats.posts.map((p) => [p.id, p]));
  const hits = stats.posts.filter((p) => p.hit).sort((a, b) => b.multiple - a.multiple);
  const topFormulas = stats.formulas.slice(0, 3);
  const restFormulas = stats.formulas.slice(3);
  const diff = previous ? stats.baseRate - previous.baseRate : null;

  return (
    <>
      {/* 한 줄 결론 */}
      <section className="card headline">
        <p className="headline-big">
          글 <b>{stats.counts.analyzed}개</b> 중 <b className="accent">{stats.counts.hits}개</b>가 평소의 {stats.baseline.threshold}배 넘게 보였어요
        </p>
        <p className="tiny muted">
          평소 조회수(중간값) {num(stats.baseline.median)}회 → {num(stats.baseline.hitViews)}회 이상이면 &quot;터짐&quot;
          {diff !== null && (
            <span className={diff >= 0 ? "up-text" : "down-text"}>
              {" "}
              · 지난 성적표보다 터진 비율 {diff >= 0 ? "▲" : "▼"} {Math.abs(Math.round(diff * 100))}%p
            </span>
          )}
        </p>
        {stats.counts.analyzed < 30 && <p className="tiny warn-text">글이 30개보다 적어서 우연일 수 있어요. 글이 쌓일수록 정확해져요.</p>}
        {advice && (
          <>
            <p className="ai-summary">{advice.summary}</p>
            <ul className="list good">
              {advice.insights.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </>
        )}
        {report.adviceError && <p className="tiny muted">AI 요약은 만들지 못했어요: {report.adviceError}</p>}
      </section>

      {/* ① 무엇이 터졌나 */}
      <section className="card">
        <h3>① 이번에 터진 글</h3>
        {hits.length ? (
          <ol className="hit-list">
            {hits.slice(0, 3).map((p) => (
              <li key={p.id}>
                <p className="hit-text">{p.text.slice(0, 70) || "(본문 없음)"}</p>
                <p className="tiny muted">
                  조회 <b className="accent">{num(p.views)}</b> · 평소의 {p.multiple.toFixed(1)}배 · {p.features.timeslot} · {p.features.media}
                  {p.permalink && (
                    <>
                      {" "}
                      ·{" "}
                      <a className="link" href={p.permalink} target="_blank" rel="noreferrer">
                        보기
                      </a>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted empty">이 기간에는 평소의 {stats.baseline.threshold}배를 넘은 글이 없어요. ⚙️ 설정에서 기준을 낮춰 볼 수 있어요.</p>
        )}
        {hits.length > 3 && <p className="tiny muted">외 {hits.length - 3}개는 아래 &quot;자세히&quot;의 글별 결과에서 볼 수 있어요.</p>}
      </section>

      {/* ② 왜 터졌나 */}
      <section className="card">
        <h3>② 왜 터졌을까</h3>
        {topFormulas.length ? (
          topFormulas.map((f, i) => (
            <FormulaCard key={i} rank={i + 1} f={f} byId={byId}>
              <Explain reportId={report.id} kind="formula" index={i} cached={report.explanations?.[`formula:${i}`]} />
            </FormulaCard>
          ))
        ) : (
          <p className="muted empty">같은 특징으로 2번 이상 터진 글이 아직 없어요. 글이 더 쌓이면 공식이 보여요.</p>
        )}
        {stats.avoid[0] && (
          <div className="formula avoid">
            <p className="tiny warn-text">⚠️ 이런 글은 피하세요</p>
            <p className="formula-cond">{formulaSentence(stats.avoid[0])}</p>
            <p className="formula-stat">{formulaResult(stats.avoid[0])}</p>
            <Explain reportId={report.id} kind="avoid" index={0} cached={report.explanations?.["avoid:0"]} />
          </div>
        )}
      </section>

      {/* ③ 다음엔 뭘 쓸까 */}
      {advice && (
        <section className="card">
          <h3>③ 다음엔 이렇게 써 보세요</h3>
          <ol className="ideas">
            {advice.nextPosts.map((p) => (
              <li key={p.firstLine}>
                <b>“{p.firstLine}”</b>
                <p className="muted">{p.outline}</p>
                <p className="tiny muted">
                  {p.when} · {p.formula}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}

      <ExportCard report={report} username={username} />

      {/* 자세히 */}
      <h4 className="detail-title">자세히 보기</h4>

      {restFormulas.length > 0 && (
        <Section title="터지는 공식 더 보기" summary={<p className="tiny muted">{restFormulas.length}개 더</p>}>
          {restFormulas.map((f, i) => (
            <FormulaCard key={i} rank={i + 4} f={f} byId={byId}>
              <Explain reportId={report.id} kind="formula" index={i + 3} cached={report.explanations?.[`formula:${i + 3}`]} />
            </FormulaCard>
          ))}
        </Section>
      )}

      {stats.avoid.length > 1 && (
        <Section title="피해야 할 글 더 보기" summary={<p className="tiny muted">{stats.avoid.length - 1}개 더</p>}>
          {stats.avoid.slice(1).map((f, i) => (
            <div key={i} className="formula avoid">
              <p className="formula-cond">{formulaSentence(f)}</p>
              <p className="formula-stat">{formulaResult(f)}</p>
              <Explain reportId={report.id} kind="avoid" index={i + 1} cached={report.explanations?.[`avoid:${i + 1}`]} />
            </div>
          ))}
        </Section>
      )}

      {stats.lifts.length > 0 && (
        <Section
          title="이런 특징이 있으면 잘 터져요"
          summary={
            <p className="tiny">
              {conditionPhrase({ dim: stats.dimensions.find((d) => d.label === stats.lifts[0].label)?.key ?? "", label: stats.lifts[0].label, value: stats.lifts[0].value })} 글:{" "}
              {pct(stats.lifts[0].rateWith)} (아니면 {pct(stats.lifts[0].rateWithout)})
            </p>
          }
        >
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
        </Section>
      )}

      <Section title="항목별 터진 확률" summary={<p className="tiny muted">시간대, 요일, 형식, 길이, 첫 문장, 전개, 참여 유도, 감정, 주제별</p>}>
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
      </Section>

      {stats.keywords.length > 0 && (
        <Section
          title="키워드별 노출량"
          summary={<p className="tiny">평균 조회 1위: {[...stats.keywords].sort((a, b) => (b.avgViews ?? 0) - (a.avgViews ?? 0))[0].keyword}</p>}
        >
          <KeywordTable keywords={stats.keywords} median={stats.baseline.median} />
        </Section>
      )}

      <Section title="글별 분류 결과" summary={<p className="tiny muted">AI가 글 {stats.posts.length}개를 어떻게 분류했는지 확인해요</p>}>
        {stats.posts.map((p) => (
          <TaggedPost key={p.id} p={p} />
        ))}
      </Section>

      <p className="tiny muted center">이번 성적표 AI 비용 {report.aiCostUsd > 0 ? won(report.aiCostUsd) : "없음"}</p>
    </>
  );
}

/** Claude 채팅앱에서 다시 분석할 수 있도록 데이터를 내려받습니다. */
function ExportCard({ report, username }: { report: ReportData; username: string }) {
  const [copied, setCopied] = useState(false);
  const day = report.createdAt.slice(0, 10);
  const base = `threads-report-${username || "account"}-${day}`;

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(CLAUDE_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("아래 문장을 복사하세요", CLAUDE_PROMPT);
    }
  }

  return (
    <section className="card">
      <h3>📥 Claude에서 더 분석하기</h3>
      <p className="tiny muted">두 파일을 내려받아 Claude 채팅에 함께 올리고, 아래 질문을 붙여 넣으면 돼요.</p>
      <div className="export-buttons">
        <button className="btn ghost small" onClick={() => downloadText(`${base}.csv`, buildCsv(report), "text/csv;charset=utf-8")}>
          글 데이터 (CSV)
        </button>
        <button className="btn ghost small" onClick={() => downloadText(`${base}.md`, buildMarkdown(report, username), "text/markdown;charset=utf-8")}>
          성적표 요약 (md)
        </button>
        <button className="btn primary small" onClick={copyPrompt}>
          {copied ? "복사했어요 ✓" : "질문 복사"}
        </button>
      </div>
      {!report.stats.posts[0]?.metrics && <p className="tiny warn-text">예전에 만든 성적표라 좋아요·답글 수가 비어 있어요. 새로 만들면 채워져요.</p>}
    </section>
  );
}

function conditionsText(f: Formula) {
  return formulaSentence(f);
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
        <span className="tiny muted">정렬</span>
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
