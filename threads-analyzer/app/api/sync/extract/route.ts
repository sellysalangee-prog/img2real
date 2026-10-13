import { NextResponse } from "next/server";
import { withAccount } from "@/lib/api";
import { extractPending } from "@/lib/sync";

export const maxDuration = 300;

/** 댓글을 새로 가져오지 않고, 정리 안 된 사람만 이어서 정리합니다. */
export async function POST() {
  return withAccount(async (account) => NextResponse.json(await extractPending(account.id)));
}
