import { NextResponse } from "next/server";
import { withAccount } from "@/lib/api";
import { syncAccount } from "@/lib/sync";

export const maxDuration = 300;

export async function POST() {
  return withAccount(async (account) => NextResponse.json(await syncAccount(account)));
}
