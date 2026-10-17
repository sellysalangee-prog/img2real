import { NextResponse } from "next/server";
import { readJson, UserError, withRole } from "@/lib/api";
import { registerAttachment } from "@/lib/attachments";

/** Blob에 올린 파일을 첨부로 등록합니다. 크기와 형식은 Blob에 저장된 값으로 다시 확인합니다. */
export async function POST(req: Request) {
  return withRole(["kid"], async () => {
    const body = await readJson<{ url: string; name: string }>(req);
    if (typeof body.url !== "string" || typeof body.name !== "string") throw new UserError("파일 정보가 없어요.");
    return NextResponse.json({ attachment: await registerAttachment(body.url, body.name) });
  });
}
