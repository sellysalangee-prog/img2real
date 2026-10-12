import { NextRequest, NextResponse } from "next/server";
import { withAccount } from "@/lib/api";
import { db } from "@/lib/db";
import { getInbox } from "@/lib/people";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? "open";
  const safe = ["open", "replied", "dismissed"].includes(status) ? status : "open";
  return withAccount(async (account) => {
    const sql = await db();
    return NextResponse.json({ items: await getInbox(sql, account.id, safe), lastSyncedAt: account.lastSyncedAt });
  });
}
