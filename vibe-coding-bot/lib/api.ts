import { NextResponse } from "next/server";
import { getSession, type Role } from "./session";

export class UserError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** 허용된 역할로 로그인했을 때만 handler를 실행하고, 공통 오류를 JSON으로 바꿉니다. */
export async function withRole(roles: Role[], handler: (role: Role) => Promise<Response>): Promise<Response> {
  const session = await getSession();
  if (!session) return jsonError("다시 로그인해 주세요.", 401);
  if (!roles.includes(session.role)) return jsonError("이 화면을 쓸 권한이 없어요.", 403);
  try {
    return await handler(session.role);
  } catch (e) {
    if (e instanceof UserError) return jsonError(e.message, e.status);
    console.error(e);
    return jsonError(e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.", 500);
  }
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<Partial<T>> {
  return ((await req.json().catch(() => null)) ?? {}) as Partial<T>;
}
