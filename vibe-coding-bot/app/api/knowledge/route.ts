import { NextResponse } from "next/server";
import { readJson, UserError, withRole } from "@/lib/api";
import { listKnowledge, saveKnowledge } from "@/lib/knowledge";

export async function GET() {
  return withRole(["kid", "admin"], async () => NextResponse.json({ docs: await listKnowledge() }));
}

/** 아이(대화에서 "프로젝트에 저장")와 관리자(업로드) 모두 씁니다. 같은 이름이면 새 버전이 됩니다. */
export async function POST(req: Request) {
  return withRole(["kid", "admin"], async (role) => {
    const body = await readJson<{ name: string; content: string; conversationId: number }>(req);
    if (typeof body.name !== "string" || typeof body.content !== "string") throw new UserError("이름과 내용이 필요해요.");
    const doc = await saveKnowledge({
      name: body.name,
      content: body.content,
      source: role,
      conversationId: typeof body.conversationId === "number" ? body.conversationId : null,
    });
    return NextResponse.json({ doc });
  });
}
