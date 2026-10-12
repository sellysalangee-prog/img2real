import { NextRequest, NextResponse } from "next/server";
import { withAccount } from "@/lib/api";
import { db } from "@/lib/db";
import { listPeople } from "@/lib/people";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 50);
  return withAccount(async (account) => NextResponse.json({ people: await listPeople(await db(), account.id, q) }));
}
