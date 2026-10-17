import { UserError, withRole } from "@/lib/api";
import { openAttachment } from "@/lib/attachments";

/** 대화창에서 첨부한 사진·파일을 다시 보여줄 때 씁니다. Blob은 비공개라 서버를 거쳐 전달합니다. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRole(["kid", "admin"], async () => {
    const id = Number((await params).id);
    const file = Number.isInteger(id) ? await openAttachment(id) : null;
    if (!file) throw new UserError("파일을 찾을 수 없어요.", 404);
    const type = file.info.kind === "text" ? "text/plain; charset=utf-8" : file.info.mediaType;
    return new Response(file.stream, {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.info.name)}`,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
