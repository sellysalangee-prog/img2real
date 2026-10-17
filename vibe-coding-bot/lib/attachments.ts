import { del, get, head } from "@vercel/blob";
import { db } from "./db";
import { UserError } from "./api";

export type AttachmentKind = "image" | "pdf" | "text";
export type AttachmentInfo = { id: number; kind: AttachmentKind; name: string; mediaType: string; size: number };

/** 사진은 Claude가 받는 한도(5MB)에 맞춥니다. 화면에서 미리 줄여 올리므로 보통 1MB 안팎입니다. */
export const MAX_BYTES: Record<AttachmentKind, number> = {
  image: 5 * 1024 * 1024,
  pdf: 20 * 1024 * 1024,
  text: 1024 * 1024,
};
export const BLOB_PREFIX = "attachments/";
/** Blob에 올릴 때 허용하는 형식. 글자 파일은 화면에서 text/plain으로 맞춰 올립니다. */
export const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain"];

export function kindOf(mediaType: string): AttachmentKind {
  if (mediaType.startsWith("image/")) return "image";
  if (mediaType === "application/pdf") return "pdf";
  return "text";
}

type Row = { id: string; kind: AttachmentKind; name: string; media_type: string; size: number; blob_url: string };
const toInfo = (r: Row): AttachmentInfo => ({ id: Number(r.id), kind: r.kind, name: r.name, mediaType: r.media_type, size: r.size });

/** 화면이 Blob에 직접 올린 파일을 확인하고 DB에 등록합니다. */
export async function registerAttachment(blobUrl: string, name: string): Promise<AttachmentInfo> {
  const host = URL.canParse(blobUrl) ? new URL(blobUrl).hostname : "";
  if (!host.endsWith(".blob.vercel-storage.com")) throw new UserError("올린 파일을 찾을 수 없어요.");
  const blob = await head(blobUrl).catch(() => null);
  if (!blob || !blob.pathname.startsWith(BLOB_PREFIX)) throw new UserError("올린 파일을 찾을 수 없어요.");
  const mediaType = blob.contentType.split(";")[0].trim();
  if (!ALLOWED_TYPES.includes(mediaType)) {
    await del(blob.url).catch(() => {});
    throw new UserError("사진(png, jpg, gif, webp), PDF, 글자로 된 파일(lua, txt, md 등)만 올릴 수 있어요.");
  }
  const kind = kindOf(mediaType);
  if (blob.size > MAX_BYTES[kind]) {
    await del(blob.url).catch(() => {});
    throw new UserError(`파일이 너무 커요. ${MAX_BYTES[kind] / 1024 / 1024}MB까지 올릴 수 있어요.`);
  }
  const sql = await db();
  const [row] = await sql<Row[]>`
    INSERT INTO attachments (kind, name, media_type, size, blob_url)
    VALUES (${kind}, ${name.slice(0, 120) || "file"}, ${mediaType}, ${blob.size}, ${blob.url})
    ON CONFLICT (blob_url) DO UPDATE SET name = EXCLUDED.name
    RETURNING id, kind, name, media_type, size, blob_url`;
  return toInfo(row);
}

/** Blob에서 파일 내용을 받아 옵니다. 비공개 저장소라 서버만 읽을 수 있습니다. */
export async function openAttachment(id: number) {
  const sql = await db();
  const [row] = await sql<Row[]>`SELECT id, kind, name, media_type, size, blob_url FROM attachments WHERE id = ${id}`;
  if (!row) return null;
  const file = await get(row.blob_url, { access: "private" });
  if (!file || file.statusCode !== 200) return null;
  return { info: toInfo(row), stream: file.stream };
}

export async function loadAttachments(ids: number[]): Promise<Map<number, AttachmentInfo & { data: Buffer }>> {
  const unique = [...new Set(ids)];
  const files = await Promise.all(
    unique.map(async (id) => {
      const file = await openAttachment(id);
      if (!file) return null;
      const data = Buffer.from(await new Response(file.stream).arrayBuffer());
      return { ...file.info, data };
    }),
  );
  return new Map(files.filter((f) => f !== null).map((f) => [f.id, f]));
}

/** 대화에 아직 연결되지 않은 첨부만 그 대화에 붙입니다. */
export async function claimAttachments(ids: number[], conversationId: number): Promise<AttachmentInfo[]> {
  if (!ids.length) return [];
  const sql = await db();
  const rows = await sql<Row[]>`
    UPDATE attachments SET conversation_id = ${conversationId}
    WHERE id IN ${sql(ids)} AND (conversation_id IS NULL OR conversation_id = ${conversationId})
    RETURNING id, kind, name, media_type, size, blob_url`;
  const byId = new Map(rows.map((r) => [Number(r.id), toInfo(r)]));
  return ids.map((id) => byId.get(id)).filter((r) => r !== undefined);
}
