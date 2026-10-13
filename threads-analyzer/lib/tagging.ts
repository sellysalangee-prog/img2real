import type postgres from "postgres";
import { z } from "zod";
import { askStructuredWithUsage, costUsd, type ModelKey, type Usage } from "./claude";
import type { Post } from "./types";

type Sql = postgres.Sql;

// ---------- 분류 항목과 보기 (보기가 고정돼 있어야 세고 비교할 수 있습니다) ----------

export const HOOKS = {
  question: "질문형",
  claim: "단정·주장형",
  confession: "경험 고백형",
  info: "정보형",
  list: "숫자·리스트형",
  exclaim: "감탄형",
  scene: "상황 묘사형",
} as const;

export const STRUCTURES = {
  situation_question: "상황→질문",
  experience_insight: "경험→깨달음",
  claim_reason: "주장→근거",
  story: "이야기",
  list: "리스트",
  info_share: "정보 공유",
  one_liner: "한 줄",
} as const;

export const CTAS = {
  ask_info: "정보 요청",
  ask_opinion: "의견 요청",
  ask_empathy: "공감 요청",
  none: "유도 없음",
} as const;

export const EMOTIONS = {
  curiosity: "호기심",
  empathy: "공감",
  humor: "웃김",
  frustration: "답답함·분노",
  touching: "감동",
  calm: "담담함",
} as const;

const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

const TagSchema = z.object({
  postId: z.string(),
  hook: z.enum(keys(HOOKS)).describe("첫 문장 유형"),
  structure: z.enum(keys(STRUCTURES)).describe("글 전개 구조"),
  cta: z.enum(keys(CTAS)).describe("독자에게 반응을 요청하는 방식"),
  emotion: z.enum(keys(EMOTIONS)).describe("독자가 주로 느낄 감정"),
  topic: z.string().describe("주제 한 단어나 짧은 명사. 가능하면 기존 주제 목록에서 고르기"),
  keywords: z.array(z.string()).describe("핵심 키워드 2~5개. 명사 위주, 가능하면 기존 키워드 재사용"),
});
export type AiTags = Omit<z.infer<typeof TagSchema>, "postId">;

const BatchSchema = z.object({ posts: z.array(TagSchema) });

const SYSTEM = `당신은 Threads 글의 구조를 분류하는 분석가입니다.
글마다 정해진 보기 중에서 가장 알맞은 것 하나씩 고릅니다. 통계를 내기 위한 분류이므로 같은 성격의 글에는 늘 같은 값을 씁니다.

- hook(첫 문장): question=질문으로 시작, claim=단정·주장, confession=자기 경험·고백, info=정보 전달, list=숫자·목록, exclaim=감탄, scene=상황 묘사
- structure(전개): situation_question=상황 설명 후 질문, experience_insight=경험 후 깨달음, claim_reason=주장 후 근거, story=사건 이야기, list=나열, info_share=정보 공유, one_liner=한두 줄
- cta(참여 유도): ask_info=답이나 정보를 물음("아는 사람?"), ask_opinion=생각을 물음, ask_empathy=공감을 구함("나만 그래?"), none=없음
- emotion: curiosity, empathy, humor, frustration, touching, calm
- topic: 짧은 한국어 명사 하나 (예: 육아, 장보기, 건강, 직장, 연애, 살림, 여행, 음식). 기존 주제 목록에 맞는 것이 있으면 반드시 그것을 씁니다.
- keywords: 글의 핵심 명사 2~5개. 기존 키워드와 같은 뜻이면 기존 표기를 씁니다.
모든 글에 대해 빠짐없이 postId를 그대로 돌려줍니다.`;

// ---------- 자동으로 계산하는 항목 ----------

export const TIME_SLOTS = [
  { from: 0, label: "새벽 0~6시" },
  { from: 6, label: "아침 6~9시" },
  { from: 9, label: "오전 9~12시" },
  { from: 12, label: "점심 12~15시" },
  { from: 15, label: "오후 15~18시" },
  { from: 18, label: "저녁 18~21시" },
  { from: 21, label: "밤 21~24시" },
];

const MEDIA: Record<string, string> = { TEXT_POST: "텍스트", IMAGE: "사진", VIDEO: "영상", CAROUSEL_ALBUM: "여러 장", AUDIO: "오디오" };

function seoulParts(iso: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(new Date(iso));
  return {
    weekday: parts.find((p) => p.type === "weekday")?.value ?? "Mon",
    hour: Number(parts.find((p) => p.type === "hour")?.value ?? 0),
  };
}

export type Features = {
  timeslot: string;
  dayType: string;
  media: string;
  length: string;
  hook: string;
  structure: string;
  cta: string;
  emotion: string;
  topic: string;
  keywords: string[];
};

/** 리포트에서 조합을 만드는 항목과 이름 */
export const DIMENSIONS: { key: Exclude<keyof Features, "keywords">; label: string }[] = [
  { key: "timeslot", label: "시간대" },
  { key: "dayType", label: "요일" },
  { key: "media", label: "형식" },
  { key: "length", label: "길이" },
  { key: "hook", label: "첫 문장" },
  { key: "structure", label: "전개 구조" },
  { key: "cta", label: "참여 유도" },
  { key: "emotion", label: "감정" },
  { key: "topic", label: "주제" },
];

export function features(post: Post, tags: AiTags): Features {
  const { weekday, hour } = seoulParts(post.timestamp);
  const slot = [...TIME_SLOTS].reverse().find((s) => hour >= s.from)!;
  const n = [...post.text].length;
  return {
    timeslot: slot.label,
    dayType: weekday === "Sat" || weekday === "Sun" ? "주말" : "평일",
    media: MEDIA[post.mediaType] ?? "텍스트",
    length: n < 60 ? "짧음 (~60자)" : n < 200 ? "보통 (60~200자)" : "김 (200자~)",
    hook: HOOKS[tags.hook as keyof typeof HOOKS] ?? tags.hook,
    structure: STRUCTURES[tags.structure as keyof typeof STRUCTURES] ?? tags.structure,
    cta: CTAS[tags.cta as keyof typeof CTAS] ?? tags.cta,
    emotion: EMOTIONS[tags.emotion as keyof typeof EMOTIONS] ?? tags.emotion,
    topic: tags.topic.trim() || "기타",
    keywords: [...new Set(tags.keywords.map((k) => k.trim()).filter(Boolean))],
  };
}

// ---------- 분류 실행 ----------

const BATCH = 10;

async function tagBatch(posts: Post[], model: ModelKey, vocab: { topics: string[]; keywords: string[] }) {
  const prompt = [
    `기존 주제 목록: ${vocab.topics.join(", ") || "(없음)"}`,
    `기존 키워드 (자주 쓴 순): ${vocab.keywords.slice(0, 80).join(", ") || "(없음)"}`,
    "",
    "## 분류할 글",
    posts.map((p) => `[postId ${p.id}] (${p.mediaType === "TEXT_POST" ? "텍스트" : "사진·영상 포함"})\n${p.text.slice(0, 1200) || "(본문 없음)"}`).join("\n\n---\n\n"),
  ].join("\n");
  const { data, usage } = await askStructuredWithUsage({ schema: BatchSchema, system: SYSTEM, prompt, model, effort: "low", maxTokens: 8000 });
  const wanted = new Set(posts.map((p) => p.id));
  const tagged = new Map<string, AiTags>();
  for (const { postId, ...tags } of data.posts) if (wanted.has(postId)) tagged.set(postId, tags);
  return { tagged, usage };
}

async function vocabulary(sql: Sql, accountId: string) {
  const [topics, keywords] = await Promise.all([
    sql<{ v: string }[]>`SELECT DISTINCT tags->>'topic' AS v FROM post_tags WHERE account_id = ${accountId} AND tags->>'topic' <> ''`,
    sql<{ v: string }[]>`
      SELECT k AS v FROM post_tags, jsonb_array_elements_text(tags->'keywords') AS k
      WHERE account_id = ${accountId} GROUP BY k ORDER BY count(*) DESC LIMIT 80`,
  ]);
  return { topics: topics.map((r) => r.v), keywords: keywords.map((r) => r.v) };
}

export async function loadTags(sql: Sql, accountId: string): Promise<Map<string, AiTags>> {
  const rows = await sql<{ post_id: string; tags: AiTags }[]>`SELECT post_id, tags FROM post_tags WHERE account_id = ${accountId}`;
  return new Map(rows.map((r) => [r.post_id, r.tags]));
}

/** 아직 분류 안 한 글을 최대 limit개 분류해 저장합니다. */
export async function tagMissing(sql: Sql, accountId: string, posts: Post[], model: ModelKey, limit: number) {
  const existing = await loadTags(sql, accountId);
  const missing = posts.filter((p) => !existing.has(p.id));
  const todo = missing.slice(0, limit);
  const vocab = await vocabulary(sql, accountId);
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };

  const batches: Post[][] = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
  let done = 0;
  await Promise.all(
    batches.map(async (batch) => {
      const r = await tagBatch(batch, model, vocab);
      usage.inputTokens += r.usage.inputTokens;
      usage.outputTokens += r.usage.outputTokens;
      const rows = [...r.tagged].map(([postId, tags]) => ({ post_id: postId, account_id: accountId, model, tags: sql.json(tags) }));
      if (rows.length) {
        await sql`
          INSERT INTO post_tags ${sql(rows)}
          ON CONFLICT (post_id) DO UPDATE SET tags = EXCLUDED.tags, model = EXCLUDED.model, created_at = now()`;
      }
      done += rows.length;
    }),
  );

  return { total: posts.length, tagged: existing.size + done, remaining: Math.max(missing.length - done, 0), usage, costUsd: costUsd(model, usage) };
}

/** 같은 글들을 두 모델로 분류해 결과와 비용을 나란히 돌려줍니다. 저장하지 않습니다. */
export async function compareModels(sql: Sql, accountId: string, posts: Post[]) {
  const vocab = await vocabulary(sql, accountId);
  const [opus, haiku] = await Promise.all([tagBatch(posts, "opus", vocab), tagBatch(posts, "haiku", vocab)]);
  const perPost = (r: typeof opus, model: ModelKey) => ({
    model,
    usage: r.usage,
    costUsd: costUsd(model, r.usage),
    costPer150: (costUsd(model, r.usage) / Math.max(posts.length, 1)) * 150,
  });
  return {
    posts: posts.map((p) => {
      const o = opus.tagged.get(p.id);
      const h = haiku.tagged.get(p.id);
      return {
        id: p.id,
        text: p.text.slice(0, 200),
        opus: o ? features(p, o) : null,
        haiku: h ? features(p, h) : null,
      };
    }),
    opus: perPost(opus, "opus"),
    haiku: perPost(haiku, "haiku"),
  };
}
