import { NextResponse } from "next/server";
import { withRole } from "@/lib/api";
import { deleteKnowledge } from "@/lib/knowledge";

/** 삭제는 관리자만 할 수 있습니다. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRole(["admin"], async () => {
    await deleteKnowledge(Number((await params).id));
    return NextResponse.json({ ok: true });
  });
}
