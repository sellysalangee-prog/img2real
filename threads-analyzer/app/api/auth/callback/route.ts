import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { cookieOptions, saveAccount, sealSession, SESSION_COOKIE, STATE_COOKIE } from "@/lib/session";
import { exchangeCode, getProfile } from "@/lib/threads";

export async function GET(req: NextRequest) {
  const home = new URL("/", env.appUrl());
  const fail = (reason: string) => {
    home.searchParams.set("error", reason);
    const res = NextResponse.redirect(home);
    res.cookies.delete(STATE_COOKIE);
    return res;
  };

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code) return fail(req.nextUrl.searchParams.get("error_description") ?? "연결이 취소되었습니다.");
  if (!state || state !== req.cookies.get(STATE_COOKIE)?.value) return fail("보안 확인에 실패했습니다. 다시 시도해 주세요.");

  try {
    const token = await exchangeCode(code);
    const profile = await getProfile(token.accessToken);
    await saveAccount({ ...profile, id: token.userId }, token);

    const res = NextResponse.redirect(home);
    res.cookies.delete(STATE_COOKIE);
    res.cookies.set(SESSION_COOKIE, sealSession({ userId: token.userId, expiresAt: token.expiresAt }), {
      ...cookieOptions,
      expires: new Date(token.expiresAt),
    });
    return res;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "토큰 발급에 실패했습니다.");
  }
}
