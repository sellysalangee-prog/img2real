import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson, withAccount } from "@/lib/api";
import type { ModelKey } from "@/lib/claude";
import { db } from "@/lib/db";
import { reportMaxPosts, withinDays } from "@/lib/report-posts";
import { tagMissing } from "@/lib/tagging";
import { getPostList } from "@/lib/threads";

export const maxDuration = 300;

/** 한 번 호출에 분류할 최대 글 수. 화면에서 남은 글이 없을 때까지 반복 호출합니다. */
const PER_CALL = 30;

const Body = z.object({ days: z.union([z.literal(30), z.literal(90), z.literal(0)]) });

export async function POST(req: Request) {
  const body = Body.safeParse(await readJson(req));
  if (!body.success) return jsonError("요청 형식이 올바르지 않습니다.", 400);

  return withAccount(async (account) => {
    const sql = await db();
    const [{ tag_model }] = await sql<{ tag_model: ModelKey }[]>`SELECT tag_model FROM accounts WHERE id = ${account.id}`;
    const posts = withinDays(await getPostList(account.token, reportMaxPosts()), body.data.days);
    return NextResponse.json(await tagMissing(sql, account.id, posts, tag_model, PER_CALL));
  });
}

/** 분류를 모두 지웁니다. 모델을 바꾼 뒤 처음부터 다시 분류할 때 씁니다. */
export async function DELETE() {
  return withAccount(async (account) => {
    const sql = await db();
    const res = await sql`DELETE FROM post_tags WHERE account_id = ${account.id}`;
    return NextResponse.json({ deleted: res.count });
  });
}
