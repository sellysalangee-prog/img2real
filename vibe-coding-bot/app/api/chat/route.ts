import { jsonError, readJson, UserError, withRole } from "@/lib/api";
import { claimAttachments } from "@/lib/attachments";
import { AiError, streamChat } from "@/lib/claude";
import { getGuidelines } from "@/lib/settings";
import { buildMessages, buildSystem } from "@/lib/context";
import {
  addAssistantMessage,
  addUserMessage,
  conversationExists,
  createConversation,
  excludeMessage,
  getMessages,
  type UserPart,
} from "@/lib/conversations";

export const maxDuration = 300;

const MAX_TEXT = 20_000;

/** 화면으로 보내는 이벤트. 한 줄에 JSON 하나씩 보냅니다. */
type ChatEvent =
  | { type: "conversation"; id: number; title: string }
  | { type: "user"; id: number; content: UserPart[] }
  | { type: "text"; text: string }
  | { type: "done"; messageId: number; notice?: string }
  | { type: "error"; message: string };

export async function POST(req: Request) {
  return withRole(["kid"], async () => {
    const body = await readJson<{ conversationId: number; text: string; attachmentIds: number[] }>(req);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const attachmentIds = Array.isArray(body.attachmentIds)
      ? body.attachmentIds.filter((n): n is number => Number.isInteger(n)).slice(0, 10)
      : [];
    if (!text && !attachmentIds.length) throw new UserError("메시지를 적어 주세요.");
    if (text.length > MAX_TEXT) throw new UserError("메시지가 너무 길어요. 긴 코드는 파일로 올려 주세요.");
    if (!(await getGuidelines()).trim()) throw new UserError("아직 준비가 덜 됐어요. 관리자에게 지침을 먼저 넣어 달라고 해 주세요.", 503);

    let conversationId = typeof body.conversationId === "number" ? body.conversationId : null;
    let isNew = false;
    if (conversationId !== null && !(await conversationExists(conversationId))) {
      return jsonError("대화를 찾을 수 없어요.", 404);
    }
    const title = (text || "사진/파일 질문").replace(/\s+/g, " ").slice(0, 40);
    if (conversationId === null) {
      conversationId = await createConversation(title);
      isNew = true;
    }

    const files = await claimAttachments(attachmentIds, conversationId);
    const parts: UserPart[] = [
      ...files.map((f) => ({ type: "attachment" as const, id: f.id, kind: f.kind, name: f.name })),
      ...(text ? [{ type: "text" as const, text }] : []),
    ];
    const userMessageId = await addUserMessage(conversationId, parts);
    const convId = conversationId;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: ChatEvent) => {
          try {
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
          } catch {
            // 화면이 닫혀도 답은 끝까지 받아서 저장합니다.
          }
        };
        if (isNew) send({ type: "conversation", id: convId, title });
        send({ type: "user", id: userMessageId, content: parts });

        try {
          const [system, messages] = await Promise.all([buildSystem(), getMessages(convId).then(buildMessages)]);
          const result = await streamChat({ system, messages, onText: (t) => send({ type: "text", text: t }) });

          if (result.stopReason === "refusal") {
            await excludeMessage(userMessageId);
            send({ type: "error", message: "이 질문에는 답하기 어려워요. 다르게 물어봐 줄래요?" });
          } else {
            const messageId = await addAssistantMessage(convId, result.content, result.model, result.usage);
            send({
              type: "done",
              messageId,
              notice: result.stopReason === "max_tokens" ? "답이 너무 길어서 중간에 끊겼어요. \"이어서 써 줘\"라고 보내 보세요." : undefined,
            });
          }
        } catch (e) {
          console.error(e);
          await excludeMessage(userMessageId).catch(() => {});
          send({ type: "error", message: e instanceof AiError ? e.message : "답을 받는 중에 문제가 생겼어요. 다시 보내 주세요." });
        } finally {
          try {
            controller.close();
          } catch {}
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
    });
  });
}
