import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { ALLOWED_TYPES, BLOB_PREFIX, MAX_BYTES } from "@/lib/attachments";
import { getSession } from "@/lib/session";

/**
 * 화면이 Vercel Blob에 직접 올릴 수 있도록 짧게 쓰는 업로드 토큰을 발급합니다.
 * 파일이 이 서버를 거치지 않으므로 Vercel 요청 크기 한도(4.5MB)에 걸리지 않습니다.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) return jsonError("잘못된 요청입니다.", 400);
  try {
    const result = await handleUpload({
      request: req,
      body,
      onBeforeGenerateToken: async (pathname) => {
        const session = await getSession();
        if (session?.role !== "kid") throw new Error("다시 로그인해 주세요.");
        if (!pathname.startsWith(BLOB_PREFIX)) throw new Error("잘못된 경로입니다.");
        return {
          allowedContentTypes: ALLOWED_TYPES,
          maximumSizeInBytes: Math.max(...Object.values(MAX_BYTES)),
          addRandomSuffix: true,
        };
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "업로드를 준비하지 못했어요.", 400);
  }
}
