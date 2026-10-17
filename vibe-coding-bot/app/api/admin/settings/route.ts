import { NextResponse } from "next/server";
import { readJson, UserError, withRole } from "@/lib/api";
import { env } from "@/lib/env";
import { DEFAULT_GUIDELINES, getGuidelines, getKidPassword, setGuidelines, setKidPassword } from "@/lib/settings";

export async function GET() {
  return withRole(["admin"], async () =>
    NextResponse.json({
      guidelines: await getGuidelines(),
      defaultGuidelines: DEFAULT_GUIDELINES,
      kidPassword: await getKidPassword(),
    }),
  );
}

export async function PUT(req: Request) {
  return withRole(["admin"], async () => {
    const body = await readJson<{ guidelines: string; kidPassword: string }>(req);

    if (typeof body.guidelines === "string") {
      if (body.guidelines.length > 50_000) throw new UserError("지침이 너무 길어요.");
      await setGuidelines(body.guidelines);
    }

    if (typeof body.kidPassword === "string") {
      const pw = body.kidPassword.trim();
      if (!/^[A-Za-z0-9]{1,40}$/.test(pw)) throw new UserError("아이 비밀번호는 영문과 숫자로 1~40자여야 합니다.");
      // 아이 비번은 대소문자를 구분하지 않으므로, 관리자 비번과 대소문자만 다르면 겹칩니다.
      if (pw.toLowerCase() === env.adminPassword().toLowerCase()) {
        throw new UserError("관리자 비밀번호와 같은 글자는 쓸 수 없습니다.");
      }
      await setKidPassword(pw);
    }

    return NextResponse.json({ guidelines: await getGuidelines(), kidPassword: await getKidPassword() });
  });
}
