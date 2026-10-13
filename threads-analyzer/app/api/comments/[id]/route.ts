import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson, withAccount } from "@/lib/api";
import { db } from "@/lib/db";
import { setCommentStatus } from "@/lib/people";

const Body = z.object({ status: z.enum(["open", "dismissed"]) });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = Body.safeParse(await readJson(req));
  if (!body.success) return jsonError("요청 형식이 올바르지 않습니다.", 400);
  return withAccount(async (account) => {
    const ok = await setCommentStatus(await db(), account.id, id, body.data.status);
    return ok ? NextResponse.json({ ok }) : jsonError("댓글을 찾을 수 없습니다.", 404);
  });
}
