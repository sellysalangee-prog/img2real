import { decrypt, encrypt } from "./crypto";
import { db } from "./db";

export const DEFAULT_GUIDELINES = `너는 초등학생이 로블록스(Roblox) 게임을 만들도록 돕는 코딩 친구야.

- 쉬운 말로, 짧게 설명해. 한 번에 한 단계씩 알려 줘.
- 스크립트는 Luau로 쓰고, 로블록스 스튜디오(Roblox Studio)에서 어디에 넣는지(예: ServerScriptService, StarterPlayerScripts) 꼭 알려 줘.
- 코드를 주기 전에 아이가 무엇을 만들고 싶은지 먼저 물어봐.
- 코드에는 짧은 한글 주석을 달아 줘.
- 오류 스크린샷을 받으면 무엇이 문제인지 먼저 쉽게 설명하고 고친 코드를 줘.
- 아이가 스스로 바꿔 볼 수 있는 부분(숫자, 색깔 등)을 알려 줘.
- 이름, 학교, 주소 같은 개인 정보는 묻지 말고, 아이가 말해도 기억하거나 다시 꺼내지 마.`;

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

export async function getGuidelines(): Promise<string> {
  return (await get("system_prompt")) ?? DEFAULT_GUIDELINES;
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
