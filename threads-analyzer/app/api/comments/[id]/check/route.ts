import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson, withAccount } from "@/lib/api";
import { db } from "@/lib/db";
import { checkReply } from "@/lib/people";

export const maxDuration = 120;

const Body = z.object({ draft: z.string().trim().min(1).max(500) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = Body.safeParse(await readJson(req));
  if (!body.success) return jsonError("답글은 1~500자로 써 주세요.", 400);
  return withAccount(async (account) => {
    const result = await checkReply(await db(), account.id, id, body.data.draft);
    return result ? NextResponse.json(result) : jsonError("댓글을 찾을 수 없습니다.", 404);
  });
}
