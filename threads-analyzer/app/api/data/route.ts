import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSession, saveSession } from "@/lib/session";
import { getAccountInsights, getPosts, getProfile, refreshIfNeeded, ThreadsError } from "@/lib/threads";
import type { DashboardData } from "@/lib/types";

export const maxDuration = 60;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Threads 계정을 다시 연결해 주세요." }, { status: 401 });

  const refreshed = await refreshIfNeeded(session);
  if (refreshed) await saveSession(refreshed);
  const token = (refreshed ?? session).accessToken;

  try {
    const [profile, posts, account] = await Promise.all([
      getProfile(token),
      getPosts(token, env.maxPosts()),
      getAccountInsights(token, 90),
    ]);
    const data: DashboardData = { profile, posts, ...account, fetchedAt: new Date().toISOString() };
    return NextResponse.json(data);
  } catch (e) {
    const status = e instanceof ThreadsError && e.isAuthError ? 401 : 502;
    const message = e instanceof Error ? e.message : "데이터를 가져오지 못했습니다.";
    return NextResponse.json({ error: message }, { status });
  }
}
