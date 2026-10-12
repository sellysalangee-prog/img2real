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
    "## 터진 확률이 높은 키워드",
    stats.keywords
      .slice(0, 10)
      .map((k) => `${k.keyword}: ${k.n}개 중 ${k.hits}개`)
      .join("\n") || "(없음)",
    "",
    "## 터진 글 원문",
    hitPosts.map((p) => `[${p.multiple.toFixed(1)}배 · ${p.features.timeslot}]\n${p.text.slice(0, 500)}`).join("\n\n---\n\n") || "(없음)",
  ].join("\n");

  const { data, usage } = await askStructuredWithUsage({ schema: AdviceSchema, system: SYSTEM, prompt, model: "opus", effort: "medium", maxTokens: 8000 });
  return { advice: data, costUsd: costUsd("opus", usage) };
}
