import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api";
import { clientIp, login } from "@/lib/login";
import { cookieOptions, sealSession, SESSION_COOKIE } from "@/lib/session";

export async function POST(req: Request) {
  const body = await readJson<{ password: string }>(req);
  const password = typeof body.password === "string" ? body.password.trim() : "";
  try {
    const result = await login(password, clientIp(req));
    if (!result.ok) return jsonError(result.message, 401);
    const { value, maxAge } = sealSession(result.role);
    const res = NextResponse.json({ role: result.role });
    res.cookies.set(SESSION_COOKIE, value, { ...cookieOptions, maxAge });
    return res;
  } catch (e) {
    console.error(e);
    return jsonError(e instanceof Error ? e.message : "로그인 중 오류가 발생했습니다.", 500);
  }
}
