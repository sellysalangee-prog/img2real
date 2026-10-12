import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { engagementRate } from "@/lib/analysis";
import { getSession } from "@/lib/session";
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
- 참여율 = (좋아요+답글+리포스트+인용+공유) ÷ 조회수 입니다.
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
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Threads 계정을 다시 연결해 주세요." }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY가 설정되지 않았습니다." }, { status: 500 });

  const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  const posts = parsed.data.posts;
  if (posts.length < 3) return NextResponse.json({ error: "분석하려면 게시글이 3개 이상 필요합니다." }, { status: 400 });

  // 답글이 많은 글 위주로 답글 본문을 가져옵니다.
  const replyTargets = [...posts].sort((a, b) => b.metrics.replies - a.metrics.replies).filter((p) => p.metrics.replies > 0).slice(0, 8);
  const replies = (await Promise.all(replyTargets.map((p) => getReplies(session.accessToken, p.id, 20)))).flat();

  const ranked = [...posts].sort((a, b) => (engagementRate(b) ?? -1) - (engagementRate(a) ?? -1));
  const prompt = [
    `분석 대상 게시글 ${posts.length}개 (참여율 높은 순)`,
    ranked.map(line).join("\n\n---\n\n"),
    `\n\n내 글에 달린 답글 샘플 ${replies.length}개`,
    replies.map((r) => `- ${r.text.slice(0, 200)}`).join("\n") || "(답글 없음)",
    "\n\n위 데이터를 바탕으로 분석 결과를 작성해 주세요.",
  ].join("\n");

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high", format: betaZodOutputFormat(InsightSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json({ error: "AI가 이 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 502 });
    }
    if (!response.parsed_output) {
      return NextResponse.json({ error: "AI 응답을 해석하지 못했습니다. 다시 시도해 주세요." }, { status: 502 });
    }
    return NextResponse.json(response.parsed_output);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "요청이 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
    }
    if (e instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "Claude API 키가 올바르지 않습니다." }, { status: 500 });
    }
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `AI 분석 오류 (${e.status ?? "연결"}): ${e.message}` }, { status: 502 });
    }
    throw e;
  }
}
