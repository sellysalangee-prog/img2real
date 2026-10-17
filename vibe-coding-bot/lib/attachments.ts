import { db } from "./db";
import { UserError } from "./api";

export type AttachmentKind = "image" | "pdf" | "text";
export type AttachmentInfo = { id: number; kind: AttachmentKind; name: string; mediaType: string; size: number };

/** Vercel 요청 한도(4.5MB) 안에 들어오도록 정한 크기입니다. */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const TEXT_EXT = /\.(lua|luau|txt|md|markdown|json|csv|xml|html|css|js|ts|py|toml|yaml|yml|log)$/i;

export function detectKind(name: string, mediaType: string): AttachmentKind {
  if (IMAGE_TYPES.includes(mediaType)) return "image";
  if (mediaType === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (mediaType.startsWith("text/") || TEXT_EXT.test(name)) return "text";
  throw new UserError("사진(png, jpg, gif, webp), PDF, 글자로 된 파일(lua, txt, md 등)만 올릴 수 있어요.");
}

export async function saveAttachment(file: File): Promise<AttachmentInfo> {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new UserError("파일이 너무 커요. 4MB까지 올릴 수 있어요.");
  const kind = detectKind(file.name, file.type);
  const mediaType = kind === "pdf" ? "application/pdf" : kind === "text" ? "text/plain" : file.type;
  const data = Buffer.from(await file.arrayBuffer());
  const sql = await db();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO attachments (kind, name, media_type, size, data)
    VALUES (${kind}, ${file.name.slice(0, 120)}, ${mediaType}, ${file.size}, ${data})
    RETURNING id`;
  return { id: Number(row.id), kind, name: file.name, mediaType, size: file.size };
}

export async function loadAttachments(ids: number[]): Promise<Map<number, AttachmentInfo & { data: Buffer }>> {
  if (!ids.length) return new Map();
  const sql = await db();
  const rows = await sql<{ id: string; kind: AttachmentKind; name: string; media_type: string; size: number; data: Buffer }[]>`
    SELECT id, kind, name, media_type, size, data FROM attachments WHERE id IN ${sql(ids)}`;
  return new Map(
    rows.map((r) => [
      Number(r.id),
      { id: Number(r.id), kind: r.kind, name: r.name, mediaType: r.media_type, size: r.size, data: r.data },
    ]),
  );
}

/** 대화에 아직 연결되지 않은 첨부만 그 대화에 붙입니다. */
export async function claimAttachments(ids: number[], conversationId: number): Promise<AttachmentInfo[]> {
  if (!ids.length) return [];
  const sql = await db();
  const rows = await sql<{ id: string; kind: AttachmentKind; name: string; media_type: string; size: number }[]>`
    UPDATE attachments SET conversation_id = ${conversationId}
    WHERE id IN ${sql(ids)} AND (conversation_id IS NULL OR conversation_id = ${conversationId})
    RETURNING id, kind, name, media_type, size`;
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  return ids
    .map((id) => byId.get(id))
    .filter((r) => r !== undefined)
    .map((r) => ({ id: Number(r.id), kind: r.kind, name: r.name, mediaType: r.media_type, size: r.size }));
}
