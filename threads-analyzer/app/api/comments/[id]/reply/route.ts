import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson, withAccount } from "@/lib/api";
import { db } from "@/lib/db";
import { recordMyReply } from "@/lib/people";
import { publishReply } from "@/lib/threads";

export const maxDuration = 60;

const Body = z.object({ text: z.string().trim().min(1).max(500) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = Body.safeParse(await readJson(req));
  if (!body.success) return jsonError("답글은 1~500자로 써 주세요.", 400);
  return withAccount(async (account) => {
    const sql = await db();
    const [comment] = await sql`SELECT id FROM comments WHERE id = ${id} AND account_id = ${account.id} AND NOT is_mine`;
    if (!comment) return jsonError("댓글을 찾을 수 없습니다.", 404);
    const replyId = await publishReply(account.token, id, body.data.text);
    await recordMyReply(sql, account.id, id, replyId, body.data.text);
    return NextResponse.json({ ok: true, replyId });
  });
}
