import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

/** 고를 수 있는 모델. 가격은 100만 토큰당 달러 (입력 / 출력, 생각 토큰은 출력으로 계산) */
export const MODELS = {
  opus: { id: "claude-opus-5-5", name: "Opus 5.5", input: 4, output: 20 },
  haiku: { id: "claude-haiku-5-5", name: "Haiku 5.5", input: 0.1, output: 0.5 },
} as const;
export type ModelKey = keyof typeof MODELS;
export const MODEL = MODELS.opus.id;

/** 화면에 보여줄 원화 환산 기준 (대략) */
export const KRW_PER_USD = 1400;

export type Usage = { inputTokens: number; outputTokens: number };

export function costUsd(model: ModelKey, usage: Usage): number {
  const m = MODELS[model];
  return (usage.inputTokens * m.input + usage.outputTokens * m.output) / 1_000_000;
}

let client: Anthropic | null = null;

export class AiError extends Error {}

/** 구조화된 JSON 응답과 사용량을 돌려줍니다. */
export async function askStructuredWithUsage<T extends z.ZodType>(opts: {
  schema: T;
  system: string;
  prompt: string;
  model?: ModelKey;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<{ data: z.infer<T>; usage: Usage }> {
  if (!process.env.ANTHROPIC_API_KEY) throw new AiError("ANTHROPIC_API_KEY가 설정되지 않았습니다.");
  client ??= new Anthropic();
  const model = opts.model ?? "opus";

  try {
    const response = await client.beta.messages.parse({
      model: MODELS[model].id,
      max_tokens: opts.maxTokens ?? 16000,
      // Opus는 거절 시 서버에서 대체 모델로 다시 시도합니다. Haiku는 이 기능이 없습니다.
      ...(model === "opus" ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
    });
    if (response.stop_reason === "refusal") throw new AiError("AI가 이 요청을 처리하지 못했습니다.");
    if (response.stop_reason === "max_tokens") throw new AiError("AI 응답이 너무 길어 중간에 끊겼습니다.");
    if (!response.parsed_output) throw new AiError("AI 응답을 해석하지 못했습니다.");
    return {
      data: response.parsed_output as z.infer<T>,
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    };
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.RateLimitError) throw new AiError("AI 요청이 많습니다. 잠시 후 다시 시도해 주세요.");
    if (e instanceof Anthropic.AuthenticationError) throw new AiError("Claude API 키가 올바르지 않습니다.");
    if (e instanceof Anthropic.APIError) throw new AiError(`AI 오류 (${e.status ?? "연결"}): ${e.message}`);
    throw e;
  }
}

/** 구조화된 JSON 응답을 받아 schema로 검증해 돌려줍니다. */
export async function askStructured<T extends z.ZodType>(opts: Parameters<typeof askStructuredWithUsage<T>>[0]): Promise<z.infer<T>> {
  return (await askStructuredWithUsage(opts)).data;
}
