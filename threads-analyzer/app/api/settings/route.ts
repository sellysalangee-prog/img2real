import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson, withAccount } from "@/lib/api";
import { db } from "@/lib/db";

const Body = z.object({ tagModel: z.enum(["opus", "haiku"]) });

export async function PATCH(req: Request) {
  const body = Body.safeParse(await readJson(req));
  if (!body.success) return jsonError("요청 형식이 올바르지 않습니다.", 400);
  return withAccount(async (account) => {
    const sql = await db();
    await sql`UPDATE accounts SET tag_model = ${body.data.tagModel} WHERE id = ${account.id}`;
    return NextResponse.json({ ok: true });
  });
}
