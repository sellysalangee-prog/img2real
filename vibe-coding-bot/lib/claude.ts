import Anthropic from "@anthropic-ai/sdk";
import type { Usage } from "./conversations";

export const MODEL = "claude-opus-5-5";

let client: Anthropic | null = null;

export class AiError extends Error {}

export type ChatResult = {
  content: Anthropic.Beta.BetaContentBlock[];
  model: string;
  usage: Usage;
  stopReason: string | null;
};

/**
 * Claude에게 대화를 보내고 글자가 오는 대로 onText로 넘깁니다.
 * - fallbacks "default": 안전 검사로 거절되면 서버가 알맞은 모델로 다시 답합니다.
 * - drop_block: 지침이나 문서가 바뀌어 예전 생각 블록이 맞지 않게 되면, 오류 대신 그 블록만 빼고 진행합니다.
 */
export async function streamChat(opts: {
  system: Anthropic.Beta.BetaTextBlockParam[];
  messages: Anthropic.Beta.BetaMessageParam[];
  onText: (text: string) => void;
}): Promise<ChatResult> {
  if (!process.env.ANTHROPIC_API_KEY) throw new AiError("ANTHROPIC_API_KEY가 설정되지 않았습니다.");
  client ??= new Anthropic();

  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01", "thinking-binding-controls-2026-08-01"],
      fallbacks: "default",
      thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
      output_config: { effort: "medium" },
      // 대화 끝부분까지 캐시해서, 다음 질문 때 앞부분을 싸게 다시 읽습니다.
      cache_control: { type: "ephemeral" },
      system: opts.system,
      messages: opts.messages,
    });
    stream.on("text", (text) => opts.onText(text));
    const final = await stream.finalMessage();
    return {
      content: final.content,
      model: final.model,
      stopReason: final.stop_reason,
      usage: {
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
        cacheReadTokens: final.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: final.usage.cache_creation_input_tokens ?? 0,
      },
    };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new AiError("지금 질문이 너무 많아요. 잠깐 뒤에 다시 보내 주세요.");
    if (e instanceof Anthropic.AuthenticationError) throw new AiError("Claude API 키가 올바르지 않습니다. 관리자에게 알려 주세요.");
    if (e instanceof Anthropic.APIError) throw new AiError(`Claude 오류 (${e.status ?? "연결"}): ${e.message}`);
    throw e;
  }
}
