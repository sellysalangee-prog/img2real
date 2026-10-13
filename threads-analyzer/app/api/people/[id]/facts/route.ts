import { NextResponse } from "next/server";
import { jsonError, readJson, withAccount } from "@/lib/api";
import { db } from "@/lib/db";
import { addFact, FactInput } from "@/lib/people";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = FactInput.safeParse(await readJson(req));
  if (!body.success) return jsonError("항목명과 내용을 입력해 주세요.", 400);
  return withAccount(async (account) => {
    const fact = await addFact(await db(), account.id, id, body.data);
    return fact ? NextResponse.json(fact) : jsonError("인물을 찾을 수 없습니다.", 404);
  });
}
