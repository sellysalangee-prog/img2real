import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loadAccount } from "@/lib/session";
import { syncAccount } from "@/lib/sync";

export const maxDuration = 300;

/** Vercel Cron이 하루 한 번 호출합니다. 이용 중인 모든 계정의 댓글을 수집합니다. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sql = await db();
  const ids = await sql<{ id: string }[]>`SELECT id FROM accounts WHERE status = 'active' ORDER BY last_synced_at NULLS FIRST`;
  const results: Record<string, unknown> = {};
  for (const { id } of ids) {
    try {
      const account = await loadAccount(id);
      results[id] = account ? await syncAccount(account) : "skipped";
    } catch (e) {
      results[id] = e instanceof Error ? e.message : String(e);
    }
  }
  return NextResponse.json(results);
}
