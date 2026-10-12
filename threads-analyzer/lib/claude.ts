import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

export const MODEL = "claude-opus-5-5";

let client: Anthropic | null = null;

export class AiError extends Error {}

/** 구조화된 JSON 응답을 받아 schema로 검증해 돌려줍니다. */
export async function askStructured<T extends z.ZodType>(opts: {
  schema: T;
  system: string;
  prompt: string;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<z.infer<T>> {
  if (!process.env.ANTHROPIC_API_KEY) throw new AiError("ANTHROPIC_API_KEY가 설정되지 않았습니다.");
  client ??= new Anthropic();

  try {
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
    });
    if (response.stop_reason === "refusal") throw new AiError("AI가 이 요청을 처리하지 못했습니다.");
    if (!response.parsed_output) throw new AiError("AI 응답을 해석하지 못했습니다.");
    return response.parsed_output as z.infer<T>;
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.RateLimitError) throw new AiError("AI 요청이 많습니다. 잠시 후 다시 시도해 주세요.");
    if (e instanceof Anthropic.AuthenticationError) throw new AiError("Claude API 키가 올바르지 않습니다.");
    if (e instanceof Anthropic.APIError) throw new AiError(`AI 오류 (${e.status ?? "연결"}): ${e.message}`);
    throw e;
  }
}
