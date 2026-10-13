import { z } from "zod";
import { askStructuredWithUsage, costUsd } from "./claude";
import type { Formula, ReportStats } from "./report";

const AdviceSchema = z.object({
  summary: z.string().describe("이 계정에서 글이 터지는 조건을 3문장 이내로 요약"),
  insights: z.array(z.string()).describe("숫자에 근거한 핵심 발견 3개. 표본 수가 적으면 그렇다고 밝히기"),
  nextPosts: z
    .array(
      z.object({
        formula: z.string().describe("따른 공식 (예: 밤 21~24시 · 질문형 · 정보 요청)"),
        firstLine: z.string().describe("첫 문장 예시. 이 계정의 말투를 따라 쓰기"),
        outline: z.string().describe("글 흐름 한두 문장"),
        when: z.string().describe("올리기 좋은 요일과 시간"),
      }),
    )
    .describe("다음 글 제안 정확히 3개"),
});
export type ReportAdvice = z.infer<typeof AdviceSchema>;

const SYSTEM = `당신은 Threads 크리에이터의 데이터 분석가입니다.
글 구조를 태그로 분류해 계산한 통계를 받아, 다음 글을 쓰는 데 바로 쓸 수 있는 조언을 줍니다.
- 반드시 주어진 숫자에 근거합니다. 표본이 3~4개뿐인 결과는 "아직 표본이 적다"고 밝힙니다.
- 상관관계일 뿐 원인이 확실하지 않다는 점을 과장 없이 다룹니다.
- 첫 문장 예시는 터진 글의 실제 말투(반말/존댓말, 길이, 이모지 사용)를 따라 씁니다.
- "반응"이라고 뭉뚱그리지 말고 좋아요·답글·리포스트·인용·공유·조회수 중 무엇인지 구체적으로 씁니다.
- 모든 문장은 한국어로 짧고 구체적으로 씁니다.`;

function formulaText(f: Formula) {
  return `${f.conditions.map((c) => `${c.label}=${c.value}`).join(" · ")} → ${f.n}개 중 ${f.hits}개 터짐 (${Math.round(f.rate * 100)}%), 평균 ${f.avgMultiple.toFixed(1)}배`;
}

export async function reportAdvice(stats: ReportStats) {
  const hitPosts = stats.posts.filter((p) => p.hit).slice(0, 8);
  const prompt = [
    `분석한 글 ${stats.counts.analyzed}개, 터진 글 ${stats.counts.hits}개 (기준: 평소 조회수 ${Math.round(stats.baseline.median)}의 ${stats.baseline.threshold}배 = ${stats.baseline.hitViews}회 이상)`,
    "",
    "## 터진 확률이 높은 조합",
    stats.formulas.map(formulaText).join("\n") || "(없음)",
    "",
    "## 피해야 할 조합",
    stats.avoid.map(formulaText).join("\n") || "(없음)",
    "",
    "## 있을 때 터질 확률이 오르는 조건",
    stats.lifts.map((l) => `${l.label}=${l.value}: ${Math.round(l.rateWith * 100)}% (없을 때 ${Math.round(l.rateWithout * 100)}%, ${l.nWith}개)`).join("\n") || "(없음)",
    "",
    "## 평균 조회수가 높은 키워드",
    stats.keywords
      .slice(0, 10)
      .map((k) => `${k.keyword}: ${k.n}개 중 ${k.hits}개 터짐, 평균 조회 ${Math.round(k.avgViews ?? 0)}회`)
      .join("\n") || "(없음)",
    "",
    "## 터진 글 원문",
    hitPosts.map((p) => `[${p.multiple.toFixed(1)}배 · ${p.features.timeslot}]\n${p.text.slice(0, 500)}`).join("\n\n---\n\n") || "(없음)",
  ].join("\n");

  const { data, usage } = await askStructuredWithUsage({ schema: AdviceSchema, system: SYSTEM, prompt, model: "opus", effort: "medium", maxTokens: 8000 });
  return { advice: data, costUsd: costUsd("opus", usage) };
}

// ---------- 조합별 원인 분석 (버튼을 눌렀을 때만) ----------

const ExplainSchema = z.object({
  summary: z.string().describe("결론 한두 문장"),
  reasons: z
    .array(z.object({ title: z.string().describe("원인 한 줄"), evidence: z.string().describe("근거가 된 글이나 숫자") }))
    .describe("원인 2~4개, 중요한 순"),
  actions: z
    .array(z.object({ tip: z.string().describe("다음 글에서 할 일"), example: z.string().describe("적용한 문장 예시") }))
    .describe("바로 쓸 수 있는 행동 2~3개"),
  rewrite: z
    .object({ originalPostId: z.string(), improved: z.string().describe("터진 글의 패턴을 살려 다시 쓴 글. 원래 말투 유지") })
    .nullable()
    .describe("안 터진 조합일 때만: 해당 글 하나를 골라 다시 쓴 버전. 터진 공식이면 null"),
});
export type Explanation = z.infer<typeof ExplainSchema> & { costUsd: number; originalText?: string };

const EXPLAIN_SYSTEM = `당신은 Threads 크리에이터의 데이터 분석가입니다.
특정 조건 조합에 해당하는 글들이 왜 터졌는지(또는 왜 안 터졌는지)를, 같은 계정의 반대쪽 글들과 비교해 설명합니다.
- 조건 자체(시간대, 형식 등)뿐 아니라 글 내용, 첫 문장, 독자가 반응할 이유가 있었는지까지 봅니다.
- 반드시 주어진 글과 숫자에 근거합니다. 표본이 적으면 그렇다고 밝힙니다.
- 원인은 단정하지 말고 "~했을 가능성이 커요"처럼 근거와 함께 씁니다.
- 예시 문장과 다시 쓴 글은 이 계정의 실제 말투(반말/존댓말, 길이, 이모지)를 따릅니다.
- "반응"이라고 뭉뚱그리지 말고 좋아요·답글·리포스트·인용·공유·조회수 중 무엇인지 구체적으로 씁니다.
- 모든 문장은 한국어로 짧고 구체적으로 씁니다.`;

type PostLine = { id: string; text: string; multiple: number; hit: boolean; features: Record<string, unknown> };

function postLine(p: PostLine) {
  const f = p.features as Record<string, string | string[]>;
  return `[postId ${p.id} · 평소의 ${p.multiple.toFixed(1)}배${p.hit ? " · 터짐" : ""} · ${f.timeslot} · ${f.media} · 첫 문장 ${f.hook} · ${f.structure} · ${f.cta} · ${f.emotion} · 주제 ${f.topic}]\n${p.text.slice(0, 500)}`;
}

export async function explainFormula(kind: "formula" | "avoid", f: Formula, stats: ReportStats) {
  const ids = new Set(f.postIds);
  const target = stats.posts.filter((p) => ids.has(p.id)).sort((a, b) => b.multiple - a.multiple).slice(0, 12);
  // 비교 대상: 안 터진 조합이면 터진 글, 터진 공식이면 같은 조건 중 일부만 해당하는 안 터진 글
  const others = stats.posts.filter((p) => !ids.has(p.id));
  const contrast =
    kind === "avoid"
      ? others.filter((p) => p.hit).slice(0, 8)
      : others
          .filter((p) => !p.hit && f.conditions.some((c) => p.features[c.dim as keyof typeof p.features] === c.value))
          .sort((a, b) => a.multiple - b.multiple)
          .slice(0, 8);

  const cond = f.conditions.map((c) => `${c.label}=${c.value}`).join(" · ");
  const prompt = [
    kind === "avoid"
      ? `## 분석할 조합 (안 터짐): ${cond}\n${f.n}개 중 ${f.hits}개 터짐, 평균 평소의 ${f.avgMultiple.toFixed(1)}배. 이 계정 전체 평균 터짐 확률은 ${Math.round(stats.baseRate * 100)}%.`
      : `## 분석할 조합 (잘 터짐): ${cond}\n${f.n}개 중 ${f.hits}개 터짐, 평균 평소의 ${f.avgMultiple.toFixed(1)}배. 이 계정 전체 평균 터짐 확률은 ${Math.round(stats.baseRate * 100)}%.`,
    f.shared.length ? `함께 나타난 특징: ${f.shared.map((c) => `${c.label}=${c.value}`).join(", ")}` : "",
    "",
    "### 이 조합에 해당하는 글",
    target.map(postLine).join("\n\n"),
    "",
    kind === "avoid" ? "### 비교용: 같은 계정에서 터진 글" : "### 비교용: 조건 일부만 같고 터지지 않은 글",
    contrast.map(postLine).join("\n\n") || "(없음)",
    "",
    kind === "avoid"
      ? "이 조합의 글들이 왜 안 터졌는지 분석하고, 해당 글 중 하나를 골라 터진 글의 패턴을 살려 다시 써 주세요."
      : "이 조합의 글들이 왜 터졌는지 분석하고, 같은 효과를 다시 내려면 무엇을 지켜야 하는지 알려 주세요. rewrite는 null로 두세요.",
  ]
    .filter(Boolean)
    .join("\n");

  const { data, usage } = await askStructuredWithUsage({ schema: ExplainSchema, system: EXPLAIN_SYSTEM, prompt, model: "opus", effort: "medium", maxTokens: 8000 });
  const original = data.rewrite ? stats.posts.find((p) => p.id === data.rewrite!.originalPostId)?.text : undefined;
  const explanation: Explanation = {
    ...data,
    rewrite: kind === "avoid" && original ? data.rewrite : null,
    originalText: original,
    costUsd: costUsd("opus", usage),
  };
  return explanation;
}
