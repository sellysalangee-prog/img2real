import { NextResponse } from "next/server";
import { jsonError, readJson, withAccount } from "@/lib/api";
import { db } from "@/lib/db";
import { deleteFact, FactPatch, updateFact } from "@/lib/people";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = FactPatch.safeParse(await readJson(req));
  if (!body.success) return jsonError("요청 형식이 올바르지 않습니다.", 400);
  return withAccount(async (account) => {
    const fact = await updateFact(await db(), account.id, id, body.data);
    return fact ? NextResponse.json(fact) : jsonError("정보를 찾을 수 없습니다.", 404);
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return withAccount(async (account) => {
    const ok = await deleteFact(await db(), account.id, id);
    return ok ? NextResponse.json({ ok }) : jsonError("정보를 찾을 수 없습니다.", 404);
  });
}
