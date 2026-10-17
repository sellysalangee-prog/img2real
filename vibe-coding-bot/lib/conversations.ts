import type Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import type { AttachmentKind } from "./attachments";

/** 아이가 보낸 메시지의 저장 형식 */
export type UserPart =
  | { type: "text"; text: string }
  | { type: "attachment"; id: number; kind: AttachmentKind; name: string };

export type StoredMessage =
  | { id: number; role: "user"; content: UserPart[]; excluded: boolean; createdAt: string }
  | { id: number; role: "assistant"; content: Anthropic.Beta.BetaContentBlock[]; excluded: boolean; createdAt: string };

export type ConversationSummary = { id: number; title: string; createdAt: string; updatedAt: string; messageCount: number };

export type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

export async function listConversations(): Promise<ConversationSummary[]> {
  const sql = await db();
  const rows = await sql<{ id: string; title: string; created_at: Date; updated_at: Date; count: string }[]>`
    SELECT c.id, c.title, c.created_at, c.updated_at,
      (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id) AS count
    FROM conversations c ORDER BY c.updated_at DESC`;
  return rows.map((r) => ({
    id: Number(r.id),
    title: r.title,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    messageCount: Number(r.count),
  }));
}

export async function createConversation(title: string): Promise<number> {
  const sql = await db();
  const [row] = await sql<{ id: string }[]>`INSERT INTO conversations (title) VALUES (${title}) RETURNING id`;
  return Number(row.id);
}

export async function conversationExists(id: number): Promise<boolean> {
  const sql = await db();
  const [row] = await sql`SELECT 1 FROM conversations WHERE id = ${id}`;
  return Boolean(row);
}

export async function getMessages(conversationId: number): Promise<StoredMessage[]> {
  const sql = await db();
  const rows = await sql<{ id: string; role: "user" | "assistant"; content: unknown; excluded: boolean; created_at: Date }[]>`
    SELECT id, role, content, excluded, created_at FROM messages WHERE conversation_id = ${conversationId} ORDER BY id`;
  return rows.map(
    (r) =>
      ({
        id: Number(r.id),
        role: r.role,
        content: r.content,
        excluded: r.excluded,
        createdAt: r.created_at.toISOString(),
      }) as StoredMessage,
  );
}

export async function addUserMessage(conversationId: number, parts: UserPart[]): Promise<number> {
  const sql = await db();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO messages (conversation_id, role, content)
    VALUES (${conversationId}, 'user', ${sql.json(parts as never)}) RETURNING id`;
  await sql`UPDATE conversations SET updated_at = now() WHERE id = ${conversationId}`;
  return Number(row.id);
}

export async function addAssistantMessage(
  conversationId: number,
  content: Anthropic.Beta.BetaContentBlock[],
  model: string,
  usage: Usage,
): Promise<number> {
  const sql = await db();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO messages (conversation_id, role, content, model, usage)
    VALUES (${conversationId}, 'assistant', ${sql.json(content as never)}, ${model}, ${sql.json(usage)}) RETURNING id`;
  await sql`UPDATE conversations SET updated_at = now() WHERE id = ${conversationId}`;
  return Number(row.id);
}

/** 답을 받지 못한 질문은 다음 요청부터 빼서, 같은 실패가 반복되지 않게 합니다. */
export async function excludeMessage(id: number): Promise<void> {
  const sql = await db();
  await sql`UPDATE messages SET excluded = true WHERE id = ${id}`;
}
