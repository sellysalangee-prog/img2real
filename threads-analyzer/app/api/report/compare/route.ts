import { NextResponse } from "next/server";
import { withAccount } from "@/lib/api";
import { db } from "@/lib/db";
import { compareModels } from "@/lib/tagging";
import { getPostList } from "@/lib/threads";

export const maxDuration = 300;

/** 최근 글 8개를 Opus와 Haiku로 똑같이 분류해 결과와 비용을 비교합니다. 결과는 저장하지 않습니다. */
export async function POST() {
  return withAccount(async (account) => {
    const posts = (await getPostList(account.token, 8)).filter((p) => p.text.trim());
    return NextResponse.json(await compareModels(await db(), account.id, posts));
  });
}
