import { NextResponse } from "next/server";
import { jsonError, readJson, withAccount } from "@/lib/api";
import { db } from "@/lib/db";
import { forgetPerson, getPerson, PersonPatch, updatePerson } from "@/lib/people";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return withAccount(async (account) => {
    const person = await getPerson(await db(), account.id, id);
    return person ? NextResponse.json(person) : jsonError("인물을 찾을 수 없습니다.", 404);
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = PersonPatch.safeParse(await readJson(req));
  if (!body.success) return jsonError("메모는 2,000자, 라벨은 12자 이내로 8개까지 쓸 수 있습니다.", 400);
  return withAccount(async (account) => {
    const ok = await updatePerson(await db(), account.id, id, body.data);
    return ok ? NextResponse.json({ ok }) : jsonError("인물을 찾을 수 없습니다.", 404);
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return withAccount(async (account) => {
    const ok = await forgetPerson(await db(), account.id, id);
    return ok ? NextResponse.json({ ok }) : jsonError("인물을 찾을 수 없습니다.", 404);
  });
}
