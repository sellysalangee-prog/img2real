import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson, withAccount } from "@/lib/api";
import { AiError } from "@/lib/claude";
import { db } from "@/lib/db";
import { computeReport } from "@/lib/report";
import { reportAdvice, type ReportAdvice } from "@/lib/report-ai";
import { reportMaxPosts, withinDays } from "@/lib/report-posts";
import { loadTags } from "@/lib/tagging";
import { getPosts } from "@/lib/threads";

export const maxDuration = 300;

export async function GET() {
  return withAccount(async (account) => {
    const sql = await db();
    const [reports, [settings]] = await Promise.all([
      sql<{ id: string; data: Record<string, unknown> & { stats?: { baseRate: number; counts: { hits: number; analyzed: number } } } }[]>`
        SELECT id::text AS id, data FROM reports WHERE account_id = ${account.id} ORDER BY created_at DESC LIMIT 2`,
      sql<{ tag_model: string; tagged: number }[]>`
        SELECT a.tag_model, (SELECT count(*)::int FROM post_tags t WHERE t.account_id = a.id) AS tagged
        FROM accounts a WHERE a.id = ${account.id}`,
    ]);
    const [latest, previous] = reports;
    return NextResponse.json({
      report: latest ? { ...latest.data, id: latest.id } : null,
      // 지난 리포트와 비교할 숫자만 보냅니다.
      previous: previous?.data.stats
        ? {
            createdAt: previous.data.createdAt,
            baseRate: previous.data.stats.baseRate,
            hits: previous.data.stats.counts.hits,
            analyzed: previous.data.stats.counts.analyzed,
          }
        : null,
      username: account.username,
      tagModel: settings.tag_model,
      tagged: settings.tagged,
    });
  });
}

const Body = z.object({ days: z.union([z.literal(30), z.literal(90), z.literal(0)]), threshold: z.number().min(1.5).max(10) });

export async function POST(req: Request) {
  const body = Body.safeParse(await readJson(req));
  if (!body.success) return jsonError("요청 형식이 올바르지 않습니다.", 400);
  const { days, threshold } = body.data;

  return withAccount(async (account) => {
    const sql = await db();
    const posts = withinDays(await getPosts(account.token, reportMaxPosts()), days);
    const tags = await loadTags(sql, account.id);
    const stats = computeReport(posts, tags, threshold);
    if (stats.counts.analyzed < 5) return jsonError("분류된 글이 5개 이상 있어야 리포트를 만들 수 있어요.", 400);

    let advice: ReportAdvice | null = null;
    let adviceError: string | null = null;
    let aiCostUsd = 0;
    try {
      const r = await reportAdvice(stats);
      advice = r.advice;
      aiCostUsd = r.costUsd;
    } catch (e) {
      if (!(e instanceof AiError)) throw e;
      adviceError = e.message;
    }

    const [{ tag_model }] = await sql<{ tag_model: string }[]>`SELECT tag_model FROM accounts WHERE id = ${account.id}`;
    const data = { createdAt: new Date().toISOString(), days, tagModel: tag_model, stats, advice, adviceError, aiCostUsd, explanations: {} };
    const [{ id }] = await sql<{ id: string }[]>`
      INSERT INTO reports (account_id, data) VALUES (${account.id}, ${sql.json(data as never)}) RETURNING id::text AS id`;
    // 오래된 리포트는 최근 10개만 남깁니다.
    await sql`
      DELETE FROM reports WHERE account_id = ${account.id}
        AND id NOT IN (SELECT id FROM reports WHERE account_id = ${account.id} ORDER BY created_at DESC LIMIT 10)`;
    return NextResponse.json({ ...data, id });
  });
}
