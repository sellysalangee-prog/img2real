import { NextRequest, NextResponse } from "next/server";
import { withAccount } from "@/lib/api";
import { db } from "@/lib/db";
import { computeTriggers, loadCommentRows } from "@/lib/influence";

/** 최근 days일 동안 달린 댓글 중 대화를 키운 댓글, 연결고리 사람, 함께 대화한 사이 */
export async function GET(req: NextRequest) {
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days")) || 30, 1), 365);
  return withAccount(async (account) => {
    const sql = await db();
    const [rows, posts] = await Promise.all([
      loadCommentRows(sql, account.id),
      sql<{ id: string; text: string }[]>`SELECT id, text FROM posts WHERE account_id = ${account.id}`,
    ]);
    const report = computeTriggers(rows, new Map(posts.map((p) => [p.id, p.text])), Date.now() - days * 86400_000);
    return NextResponse.json(report);
  });
}
