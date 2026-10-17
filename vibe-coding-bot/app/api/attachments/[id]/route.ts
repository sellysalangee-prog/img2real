import { UserError, withRole } from "@/lib/api";
import { loadAttachments } from "@/lib/attachments";

/** 대화창에서 첨부한 사진·파일을 다시 보여줄 때 씁니다. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRole(["kid", "admin"], async () => {
    const id = Number((await params).id);
    const file = Number.isInteger(id) ? (await loadAttachments([id])).get(id) : undefined;
    if (!file) throw new UserError("파일을 찾을 수 없어요.", 404);
    const type = file.kind === "text" ? "text/plain; charset=utf-8" : file.mediaType;
    return new Response(new Uint8Array(file.data), {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
