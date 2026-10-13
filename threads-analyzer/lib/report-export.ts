import type { ReportStats } from "./report";
import type { ReportAdvice } from "./report-ai";
import { formulaResult, formulaSentence } from "./report-text";

export type ExportableReport = {
  createdAt: string;
  days: number;
  stats: ReportStats;
  advice: ReportAdvice | null;
};

const KST = "Asia/Seoul";

function kst(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: KST, ...opts }).format(new Date(iso));
}

function csvCell(v: string | number | boolean | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 글 한 줄 = 한 행. 엑셀에서 한글이 깨지지 않도록 BOM을 붙입니다. */
export function buildCsv(report: ExportableReport): string {
  const header = [
    "post_id",
    "날짜",
    "요일",
    "시간대",
    "평일주말",
    "형식",
    "길이",
    "글자수",
    "조회수",
    "좋아요",
    "답글",
    "리포스트",
    "인용",
    "공유",
    "참여율(%)",
    "평소대비(배)",
    "터짐",
    "첫문장",
    "전개",
    "참여유도",
    "감정",
    "주제",
    "키워드",
    "링크",
    "본문",
  ];
  const rows = [...report.stats.posts]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((p) => {
      const m = p.metrics;
      const reactions = m ? m.likes + m.replies + m.reposts + m.quotes + m.shares : null;
      return [
        p.id,
        new Intl.DateTimeFormat("sv-SE", { timeZone: KST, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(
          new Date(p.timestamp),
        ),
        kst(p.timestamp, { weekday: "short" }),
        p.features.timeslot,
        p.features.dayType,
        p.features.media,
        p.features.length,
        [...p.text].length,
        p.views,
        m?.likes,
        m?.replies,
        m?.reposts,
        m?.quotes,
        m?.shares,
        reactions !== null && p.views > 0 ? ((reactions / p.views) * 100).toFixed(2) : "",
        p.multiple.toFixed(2),
        p.hit ? "Y" : "N",
        p.features.hook,
        p.features.structure,
        p.features.cta,
        p.features.emotion,
        p.features.topic,
        p.features.keywords.join("|"),
        p.permalink,
        p.text.replace(/\s+/g, " ").trim(),
      ].map(csvCell);
    });
  return "﻿" + [header.map(csvCell), ...rows].map((r) => r.join(",")).join("\r\n");
}

/** Claude 채팅에 함께 올릴 요약과 데이터 설명서 */
export function buildMarkdown(report: ExportableReport, username: string): string {
  const { stats, advice } = report;
  const period = report.days ? `최근 ${report.days}일` : "전체 기간";
  const lines: string[] = [
    `# @${username} Threads 성적표 (${period})`,
    "",
    `- 만든 날: ${kst(report.createdAt, { year: "numeric", month: "long", day: "numeric" })}`,
    `- 분석한 글: ${stats.counts.analyzed}개 (올린 지 하루 안 된 글 ${stats.counts.excludedRecent}개 제외)`,
    `- 평소 조회수(중간값): ${Math.round(stats.baseline.median).toLocaleString("ko-KR")}회`,
    `- 터짐 기준: 평소의 ${stats.baseline.threshold}배 = ${stats.baseline.hitViews.toLocaleString("ko-KR")}회 이상`,
    `- 터진 글: ${stats.counts.hits}개 (${Math.round(stats.baseRate * 100)}%)`,
    "",
  ];
  if (advice) {
    lines.push("## 한 줄 요약", "", advice.summary, "", ...advice.insights.map((t) => `- ${t}`), "");
  }
  lines.push("## 터지는 공식", "");
  stats.formulas.forEach((f, i) => lines.push(`${i + 1}. ${formulaSentence(f)} → ${formulaResult(f)}`));
  if (stats.avoid.length) {
    lines.push("", "## 피해야 할 조합", "");
    stats.avoid.forEach((f) => lines.push(`- ${formulaSentence(f)} → ${formulaResult(f)}`));
  }
  if (stats.keywords.length) {
    lines.push("", "## 키워드별 노출 (평균 조회 상위 10)", "", "| 키워드 | 글 수 | 평균 조회 | 평소 대비 | 터짐 |", "|---|---|---|---|---|");
    [...stats.keywords]
      .sort((a, b) => (b.avgViews ?? 0) - (a.avgViews ?? 0))
      .slice(0, 10)
      .forEach((k) => lines.push(`| ${k.keyword} | ${k.n} | ${Math.round(k.avgViews ?? 0).toLocaleString("ko-KR")} | ${k.avgMultiple.toFixed(1)}배 | ${k.hits}/${k.n} |`));
  }
  if (advice) {
    lines.push("", "## 다음 글 제안", "");
    advice.nextPosts.forEach((p) => lines.push(`- "${p.firstLine}" — ${p.outline} (${p.when}, 공식: ${p.formula})`));
  }
  lines.push(
    "",
    "## 함께 보낸 CSV 설명",
    "",
    "글 한 개가 한 줄입니다. 시간은 한국 시간입니다.",
    "",
    "| 칸 | 뜻 |",
    "|---|---|",
    "| 조회수·좋아요·답글·리포스트·인용·공유 | Threads 공식 API에서 받은 숫자 (리포트를 만든 시점 기준) |",
    "| 참여율(%) | (좋아요+답글+리포스트+인용+공유) ÷ 조회수 × 100 |",
    "| 평소대비(배) | 조회수 ÷ 평소 조회수(중간값) |",
    `| 터짐 | 평소대비가 ${stats.baseline.threshold}배 이상이면 Y |`,
    "| 첫문장·전개·참여유도·감정·주제·키워드 | AI가 정해진 보기 안에서 분류한 글 구조 |",
    "| 시간대·평일주말·형식·길이 | 올린 시각과 글에서 자동 계산 |",
    "",
    "## Claude에게 이렇게 물어보세요",
    "",
    "- 이 데이터로 다음 달 Threads 운영 전략을 짜 줘. 근거가 된 숫자도 같이 보여 줘.",
    "- 터진 글과 안 터진 글의 첫 문장을 비교해서, 내 말투로 다음 글 첫 문장 10개를 제안해 줘.",
    "- 표본이 적어서 믿기 어려운 결론이 있으면 골라서 알려 줘.",
  );
  return lines.join("\n");
}

export const CLAUDE_PROMPT =
  "첨부한 Threads 성적표(md)와 글 데이터(CSV)를 읽고, 다음 달 운영 전략을 세워 줘. 무엇을 더 하고 무엇을 줄일지, 올릴 요일과 시간, 다음 글 아이디어 5개를 근거 숫자와 함께 정리해 줘. 표본이 적은 결론은 따로 표시해 줘.";

export function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
