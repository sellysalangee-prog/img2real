import { cookies } from "next/headers";
import { decrypt, encrypt } from "./crypto";
import { db } from "./db";
import { refreshToken, type TokenSet } from "./threads";

export const SESSION_COOKIE = "th_session";
export const STATE_COOKIE = "th_oauth_state";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 쿠키에는 계정 식별 정보만 담고, 토큰은 DB에 암호화해 보관합니다. */
export type Session = { userId: string; expiresAt: number };

export type Account = {
  id: string;
  username: string;
  name: string | null;
  picture: string | null;
  status: string;
  lastSyncedAt: Date | null;
  token: string;
};

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export function sealSession(session: Session): string {
  return encrypt(JSON.stringify(session));
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

type AccountRow = {
  id: string;
  username: string;
  name: string | null;
  picture: string | null;
  status: string;
  last_synced_at: Date | null;
  token_enc: string;
  token_issued_at: Date;
  token_expires_at: Date;
};

export async function saveAccount(
  profile: { id: string; username: string; name: string | null; picture: string | null },
  token: TokenSet,
): Promise<void> {
  const sql = await db();
  await sql`
    INSERT INTO accounts (id, username, name, picture, token_enc, token_issued_at, token_expires_at)
    VALUES (${profile.id}, ${profile.username}, ${profile.name}, ${profile.picture}, ${encrypt(token.accessToken)},
            ${new Date(token.issuedAt)}, ${new Date(token.expiresAt)})
    ON CONFLICT (id) DO UPDATE SET
      username = EXCLUDED.username, name = EXCLUDED.name, picture = EXCLUDED.picture,
      token_enc = EXCLUDED.token_enc, token_issued_at = EXCLUDED.token_issued_at, token_expires_at = EXCLUDED.token_expires_at`;
}

/** 계정을 불러오고, 만료 7일 전이면 토큰을 갱신합니다. 이용이 중지된 계정은 null입니다. */
export async function loadAccount(userId: string): Promise<Account | null> {
  const sql = await db();
  const [row] = await sql<AccountRow[]>`SELECT * FROM accounts WHERE id = ${userId}`;
  if (!row || row.status !== "active") return null;
  let token = decrypt(row.token_enc);
  if (!token || row.token_expires_at.getTime() < Date.now()) return null;

  const now = Date.now();
  const expiresSoon = row.token_expires_at.getTime() - now < 7 * DAY_MS;
  const oldEnough = now - row.token_issued_at.getTime() > DAY_MS;
  if (expiresSoon && oldEnough) {
    const fresh = await refreshToken(token).catch(() => null);
    if (fresh) {
      token = fresh.accessToken;
      await sql`
        UPDATE accounts SET token_enc = ${encrypt(fresh.accessToken)},
          token_issued_at = ${new Date(fresh.issuedAt)}, token_expires_at = ${new Date(fresh.expiresAt)}
        WHERE id = ${row.id}`;
    }
  }

  return {
    id: row.id,
    username: row.username,
    name: row.name,
    picture: row.picture,
    status: row.status,
    lastSyncedAt: row.last_synced_at,
    token,
  };
}

/** 로그인한 계정을 돌려줍니다. 없으면 null */
export async function currentAccount(): Promise<Account | null> {
  const session = await getSession();
  return session ? loadAccount(session.userId) : null;
}
