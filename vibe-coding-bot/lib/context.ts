import type Anthropic from "@anthropic-ai/sdk";
import { loadAttachments } from "./attachments";
import type { StoredMessage, UserPart } from "./conversations";
import { latestKnowledge } from "./knowledge";
import { getGuidelines } from "./settings";

type SystemBlock = Anthropic.Beta.BetaTextBlockParam;
type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentParam = Anthropic.Beta.BetaContentBlockParam;

/** 앱이 항상 덧붙이는 규칙. "프로젝트에 저장" 버튼이 동작하려면 이 형식이 필요합니다. */
const APP_RULES = `[앱 규칙]
- 코드는 언어를 적은 코드 블록으로 써. 로블록스 스크립트는 \`\`\`lua 로 시작해.
- 계획, 정리, 설명서처럼 프로젝트에 저장해 둘 만한 문서를 쓸 때는 문서 전체를 코드 블록 하나로 감싸고, 첫 줄을 \`\`\`markdown 파일이름.md 형식으로 써. 파일이름은 영어 소문자와 하이픈으로 (예: \`\`\`markdown game-plan.md).
- 이미 프로젝트 지식에 있는 문서를 고쳐 쓸 때는 같은 파일이름을 써. 그러면 새 버전으로 저장돼.
- 아래 <project_knowledge>는 지금까지 저장된 프로젝트 문서들이야. 이름마다 가장 새 버전만 들어 있어.`;

/**
 * Claude에게 보낼 맥락 조각들. 순서대로 system에 들어갑니다.
 * 나중에 기억(memory) 같은 조각을 여기에 추가하면 됩니다.
 */
type ContextSource = () => Promise<string | null>;

const knowledgeSource: ContextSource = async () => {
  const docs = await latestKnowledge();
  if (!docs.length) return "<project_knowledge>\n(아직 저장된 문서가 없어)\n</project_knowledge>";
  const body = docs
    .map((d) => `<document name="${d.name}" version="${d.version}" saved="${d.createdAt.slice(0, 10)}">\n${d.content}\n</document>`)
    .join("\n\n");
  return `<project_knowledge>\n${body}\n</project_knowledge>`;
};

const CONTEXT_SOURCES: ContextSource[] = [getGuidelines, async () => APP_RULES, knowledgeSource];

export async function buildSystem(): Promise<SystemBlock[]> {
  const texts = await Promise.all(CONTEXT_SOURCES.map((source) => source()));
  const blocks: SystemBlock[] = texts.filter((t): t is string => Boolean(t?.trim())).map((text) => ({ type: "text", text }));
  // 지침과 문서는 대화 내내 거의 같으니 캐시해 둡니다.
  if (blocks.length) blocks[blocks.length - 1].cache_control = { type: "ephemeral" };
  return blocks;
}

const REPLAY_TYPES = new Set(["text", "thinking", "redacted_thinking"]);

/**
 * 저장된 Claude 응답을 다시 보낼 형태로 바꿉니다. 생각(thinking) 블록은 바꾸지 않고 그대로 보냅니다.
 * 응답 중간에 다른 모델로 넘어간(fallback) 경우, 넘어가기 전의 생각 블록은 빼야 합니다.
 */
function assistantReplay(content: Anthropic.Beta.BetaContentBlock[]): ContentParam[] {
  const lastFallback = content.map((b) => b.type).lastIndexOf("fallback");
  return content.filter((block, i) => {
    if (!REPLAY_TYPES.has(block.type)) return false;
    if (i < lastFallback && block.type !== "text") return false;
    return true;
  }) as ContentParam[];
}

function userParts(parts: UserPart[], files: Awaited<ReturnType<typeof loadAttachments>>): ContentParam[] {
  const out: ContentParam[] = [];
  // Claude는 사진·문서가 질문보다 앞에 있을 때 더 잘 읽습니다.
  for (const part of parts) {
    if (part.type !== "attachment") continue;
    const file = files.get(part.id);
    if (!file) {
      out.push({ type: "text", text: `(첨부 "${part.name}"를 찾을 수 없음)` });
    } else if (file.kind === "image") {
      out.push({
        type: "image",
        source: { type: "base64", media_type: file.mediaType as "image/png", data: file.data.toString("base64") },
      });
    } else if (file.kind === "pdf") {
      out.push({
        type: "document",
        title: file.name,
        source: { type: "base64", media_type: "application/pdf", data: file.data.toString("base64") },
      });
    } else {
      out.push({ type: "text", text: `<file name="${file.name}">\n${file.data.toString("utf8")}\n</file>` });
    }
  }
  for (const part of parts) if (part.type === "text" && part.text.trim()) out.push({ type: "text", text: part.text });
  return out;
}

/** 저장된 대화를 API 메시지로 바꿉니다. 같은 역할이 이어지면 하나로 합칩니다. */
export async function buildMessages(history: StoredMessage[]): Promise<MessageParam[]> {
  const included = history.filter((m) => !m.excluded);
  const ids = included.flatMap((m) =>
    m.role === "user" ? m.content.filter((p) => p.type === "attachment").map((p) => p.id) : [],
  );
  const files = await loadAttachments(ids);

  const messages: MessageParam[] = [];
  for (const m of included) {
    const content = m.role === "user" ? userParts(m.content, files) : assistantReplay(m.content);
    if (!content.length) continue;
    const last = messages[messages.length - 1];
    if (last && last.role === m.role) (last.content as ContentParam[]).push(...content);
    else messages.push({ role: m.role, content });
  }
  return messages;
}
