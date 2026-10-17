import { NextResponse } from "next/server";
import { UserError, withRole } from "@/lib/api";
import { saveAttachment } from "@/lib/attachments";

export async function POST(req: Request) {
  return withRole(["kid"], async () => {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new UserError("파일이 없어요.");
    return NextResponse.json({ attachment: await saveAttachment(file) });
  });
}
