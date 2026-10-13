import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson, withAccount } from "@/lib/api";
import { db } from "@/lib/db";
import type { ReportStats } from "@/lib/report";
import { explainFormula, type Explanation } from "@/lib/report-ai";

export const maxDuration = 120;

const Body = z.object({
  reportId: z.string().regex(/^\d+$/),
  kind: z.enum(["formula", "avoid"]),
  index: z.number().int().min(0).max(9),
});

/** 리포트의 조합 하나를 골라 왜 터졌는지(안 터졌는지) 분석합니다. 결과는 리포트에 저장해 다시 볼 때 비용이 들지 않습니다. */
export async function POST(req: Request) {
  const body = Body.safeParse(await readJson(req));
  if (!body.success) return jsonError("요청 형식이 올바르지 않습니다.", 400);
  const { reportId, kind, index } = body.data;
  const key = `${kind}:${index}`;

  return withAccount(async (account) => {
    const sql = await db();
    const [row] = await sql<{ data: { stats: ReportStats; explanations?: Record<string, Explanation> } }[]>`
      SELECT data FROM reports WHERE id = ${reportId} AND account_id = ${account.id}`;
    if (!row) return jsonError("리포트를 찾을 수 없습니다. 리포트를 다시 만들어 주세요.", 404);

    const cached = row.data.explanations?.[key];
    if (cached) return NextResponse.json({ ...cached, costUsd: 0 });

    const formula = (kind === "avoid" ? row.data.stats.avoid : row.data.stats.formulas)[index];
    if (!formula) return jsonError("조합을 찾을 수 없습니다.", 404);

    const explanation = await explainFormula(kind, formula, row.data.stats);
    await sql`
      UPDATE reports SET data = jsonb_set(
        jsonb_set(data, '{explanations}', COALESCE(data->'explanations', '{}'::jsonb), true),
        ${sql.array(["explanations", key])}::text[], ${sql.json(explanation as never)}, true)
      WHERE id = ${reportId}`;
    return NextResponse.json(explanation);
  });
}
