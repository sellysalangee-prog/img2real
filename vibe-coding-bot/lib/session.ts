import { cookies } from "next/headers";
import { decrypt, encrypt } from "./crypto";

export const SESSION_COOKIE = "vb_session";

export type Role = "kid" | "admin";
export type Session = { role: Role; expiresAt: number };

const DAY_MS = 24 * 60 * 60 * 1000;
/** 아이는 자주 로그인하지 않도록 길게, 관리자는 짧게 유지합니다. */
export const SESSION_DAYS: Record<Role, number> = { kid: 30, admin: 1 };

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export function sealSession(role: Role): { value: string; maxAge: number } {
  const days = SESSION_DAYS[role];
  const session: Session = { role, expiresAt: Date.now() + days * DAY_MS };
  return { value: encrypt(JSON.stringify(session)), maxAge: days * 24 * 60 * 60 };
}

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  const json = raw ? decrypt(raw) : null;
  if (!json) return null;
  try {
    const session = JSON.parse(json) as Session;
    return session.expiresAt > Date.now() ? session : null;
  } catch {
    return null;
  }
}
