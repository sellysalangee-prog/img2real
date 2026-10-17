import { decrypt, encrypt } from "./crypto";
import { db } from "./db";

async function get(key: string): Promise<string | null> {
  const sql = await db();
  const [row] = await sql<{ value: string }[]>`SELECT value FROM settings WHERE key = ${key}`;
  return row?.value ?? null;
}

async function set(key: string, value: string): Promise<void> {
  const sql = await db();
  await sql`
    INSERT INTO settings (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

/** 지침은 관리자 화면에서 입력한 값만 씁니다. 코드에 기본값을 두지 않습니다. */
export async function getGuidelines(): Promise<string> {
  return (await get("system_prompt")) ?? "";
}

export async function setGuidelines(text: string): Promise<void> {
  await set("system_prompt", text);
}

/** 아이 비밀번호. 관리자가 확인할 수 있어야 해서 해시 대신 암호화해 보관합니다. */
export async function getKidPassword(): Promise<string | null> {
  const raw = await get("kid_password");
  return raw ? decrypt(raw) : null;
}

export async function setKidPassword(password: string): Promise<void> {
  await set("kid_password", encrypt(password));
}
