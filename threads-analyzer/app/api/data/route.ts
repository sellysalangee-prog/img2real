import { NextResponse } from "next/server";
import { withAccount } from "@/lib/api";
import { env } from "@/lib/env";
import { getAccountInsights, getPosts, getProfile } from "@/lib/threads";
import type { DashboardData } from "@/lib/types";

export const maxDuration = 60;

export async function GET() {
  return withAccount(async ({ token }) => {
    const [profile, posts, account] = await Promise.all([getProfile(token), getPosts(token, env.maxPosts()), getAccountInsights(token, 90)]);
    const data: DashboardData = { profile, posts, ...account, fetchedAt: new Date().toISOString() };
    return NextResponse.json(data);
  });
}
