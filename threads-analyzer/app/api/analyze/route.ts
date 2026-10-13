import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { engagementRate } from "@/lib/analysis";
import { jsonError, readJson, withAccount } from "@/lib/api";
import { askStructured } from "@/lib/claude";
import { getReplies } from "@/lib/threads";
import type { Post } from "@/lib/types";

export const maxDuration = 300;

const InsightSchema = z.object({
  summary: z.string().describe("전체 흐름을 3~4문장으로 요약"),
  winningPatterns: z.array(z.string()).describe("반응이 좋았던 글의 공통점 3~5개"),
  losingPatterns: z.array(z.string()).describe("반응이 약했던 글의 공통점 2~4개"),
  topics: z
    .array(z.object({ name: z.string(), postCount: z.number(), performance: z.string().describe("이 주제의 성과를 한 줄로") }))
    .describe("주요 주제 3~6개"),
  replyMood: z.object({
    positive: z.number().describe("긍정 답글 비율 (0~100)"),
    negative: z.number().describe("부정 답글 비율 (0~100)"),
    question: z.number().describe("질문 답글 비율 (0~100)"),
    note: z.string().describe("답글 분위기 한두 문장 요약"),
  }),
  nextIdeas: z.array(z.object({ title: z.string(), why: z.string() })).describe("다음에 쓸 글 아이디어 정확히 3개"),
});

const RequestSchema = z.object({
  posts: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        mediaType: z.string(),
        timestamp: z.string(),
        permalink: z.string().nullable(),
        isQuote: z.boolean(),
        metrics: z.object({
          views: z.number(),
          likes: z.number(),
          replies: z.number(),
          reposts: z.number(),
          quotes: z.number(),
          shares: z.number(),
        }),
      }),
    )
    .max(500),
});

const SYSTEM = `당신은 Threads(스레드) 크리에이터를 돕는 콘텐츠 분석가입니다.
사용자 본인의 게시글과 지표를 받아, 다음 글을 더 잘 쓰는 데 바로 쓸 수 있는 인사이트를 줍니다.
- 반드시 데이터에 근거해 말하고, 근거가 약하면 그렇다고 밝히세요.
- 참여율 = (좋아요+답글+리포스트+인용+공유) ÷ 조회수 입니다. 참여율을 말할 때는 "참여율(조회 대비 반응 비율)"처럼 처음 한 번 풀어 씁니다.
- "반응이 적었다"처럼 뭉뚱그리지 말고, 좋아요·답글·리포스트·인용·공유·조회수 중 무엇이 많았고 적었는지 숫자와 함께 구체적으로 씁니다.
- 모든 문장은 한국어 존댓말로, 짧고 구체적으로 씁니다.`;

function line(p: Post): string {
  const rate = engagementRate(p);
  const m = p.metrics;
  return [
    `[${p.timestamp.slice(0, 16)}] ${p.mediaType}${p.isQuote ? " (인용)" : ""}`,
    `조회 ${m.views} · 좋아요 ${m.likes} · 답글 ${m.replies} · 리포스트 ${m.reposts} · 인용 ${m.quotes} · 공유 ${m.shares} · 참여율 ${rate === null ? "-" : (rate * 100).toFixed(1) + "%"}`,
    p.text.slice(0, 600) || "(본문 없음)",
  ].join("\n");
}

export async function POST(req: NextRequest) {
  const parsed = RequestSchema.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("요청 형식이 올바르지 않습니다.", 400);
  const posts = parsed.data.posts;
  if (posts.length < 3) return jsonError("분석하려면 게시글이 3개 이상 필요합니다.", 400);

  return withAccount(async (account) => {
    // 답글이 많은 글 위주로 답글 본문을 가져옵니다.
    const replyTargets = [...posts].sort((a, b) => b.metrics.replies - a.metrics.replies).filter((p) => p.metrics.replies > 0).slice(0, 8);
    const replies = (await Promise.all(replyTargets.map((p) => getReplies(account.token, p.id, 20)))).flat();

    const ranked = [...posts].sort((a, b) => (engagementRate(b) ?? -1) - (engagementRate(a) ?? -1));
    const prompt = [
      `분석 대상 게시글 ${posts.length}개 (참여율 높은 순)`,
      ranked.map(line).join("\n\n---\n\n"),
      `\n\n내 글에 달린 답글 샘플 ${replies.length}개`,
      replies.map((r) => `- ${r.text.slice(0, 200)}`).join("\n") || "(답글 없음)",
      "\n\n위 데이터를 바탕으로 분석 결과를 작성해 주세요.",
    ].join("\n");

    const result = await askStructured({ schema: InsightSchema, system: SYSTEM, prompt, effort: "high" });
    return NextResponse.json(result);
  });
}
