import { NextResponse } from "next/server";
import { UserError, withRole } from "@/lib/api";
import { conversationExists, getMessages } from "@/lib/conversations";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRole(["kid", "admin"], async () => {
    const id = Number((await params).id);
    if (!Number.isInteger(id) || !(await conversationExists(id))) throw new UserError("대화를 찾을 수 없어요.", 404);
    return NextResponse.json({ messages: await getMessages(id) });
  });
}
