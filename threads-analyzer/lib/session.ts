import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";

export const SESSION_COOKIE = "th_session";
export const STATE_COOKIE = "th_oauth_state";

export type Session = {
  userId: string;
  accessToken: string;
  /** 토큰 만료 시각 (ms) */
  expiresAt: number;
  /** 토큰 발급 또는 갱신 시각 (ms) */
  issuedAt: number;
};

function key(): Buffer {
  return createHash("sha256").update(env.sessionSecret()).digest();
}

export function seal(session: Session): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function unseal(value: string): Session | null {
  try {
    const [iv, tag, body] = value.split(".").map((p) => Buffer.from(p, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    const session = JSON.parse(json) as Session;
    return session.expiresAt > Date.now() ? session : null;
  } catch {
    return null;
  }
}

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  return raw ? unseal(raw) : null;
}

export async function saveSession(session: Session): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, seal(session), {
    ...cookieOptions,
    expires: new Date(session.expiresAt),
  });
}
