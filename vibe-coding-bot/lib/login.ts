import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { env } from "./env";
import { getKidPassword } from "./settings";
import type { Role } from "./session";

export const MAX_FAILS = 5;
export const LOCK_MINUTES = 5;

function same(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export type LoginResult = { ok: true; role: Role } | { ok: false; message: string };

function lockMessage(until: Date): string {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60000));
  return `비밀번호를 ${MAX_FAILS}번 틀렸어요. ${minutes}분 뒤에 다시 해 주세요.`;
}

/** 관리자 비번은 대소문자를 구분하고, 아이 비번은 구분하지 않습니다. */
export async function login(password: string, ip: string): Promise<LoginResult> {
  const sql = await db();
  const [attempt] = await sql<{ fails: number; locked_until: Date | null }[]>`
    SELECT fails, locked_until FROM login_attempts WHERE ip = ${ip}`;
  if (attempt?.locked_until && attempt.locked_until.getTime() > Date.now()) {
    return { ok: false, message: lockMessage(attempt.locked_until) };
  }

  let role: Role | null = null;
  if (password && same(password, env.adminPassword())) role = "admin";
  else {
    const kid = await getKidPassword();
    if (kid && password && same(password.toLowerCase(), kid.toLowerCase())) role = "kid";
  }

  if (role) {
    await sql`DELETE FROM login_attempts WHERE ip = ${ip}`;
    return { ok: true, role };
  }

  const [row] = await sql<{ fails: number; locked_until: Date | null }[]>`
    INSERT INTO login_attempts (ip, fails) VALUES (${ip}, 1)
    ON CONFLICT (ip) DO UPDATE SET
      fails = CASE WHEN login_attempts.locked_until IS NOT NULL THEN 1 ELSE login_attempts.fails + 1 END,
      locked_until = NULL
    RETURNING fails, locked_until`;
  if (row.fails >= MAX_FAILS) {
    const until = new Date(Date.now() + LOCK_MINUTES * 60000);
    await sql`UPDATE login_attempts SET fails = 0, locked_until = ${until} WHERE ip = ${ip}`;
    return { ok: false, message: lockMessage(until) };
  }
  return { ok: false, message: `비밀번호가 맞지 않아요. (${MAX_FAILS - row.fails}번 더 틀리면 ${LOCK_MINUTES}분 잠겨요)` };
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "unknown";
}
