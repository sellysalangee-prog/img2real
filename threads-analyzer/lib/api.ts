import { NextResponse } from "next/server";
import { AiError } from "./claude";
import { currentAccount, type Account } from "./session";
import { ThreadsError } from "./threads";

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** 로그인한 계정으로 handler를 실행하고, 공통 오류를 JSON으로 바꿉니다. */
export async function withAccount(handler: (account: Account) => Promise<Response>): Promise<Response> {
  const account = await currentAccount();
  if (!account) return jsonError("Threads 계정을 다시 연결해 주세요.", 401);
  try {
    return await handler(account);
  } catch (e) {
    if (e instanceof ThreadsError) return jsonError(e.message, e.isAuthError ? 401 : 502);
    if (e instanceof AiError) return jsonError(e.message, 502);
    console.error(e);
    return jsonError(e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.", 500);
  }
}

export async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}
