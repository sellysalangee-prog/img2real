import { db } from "./db";
import { UserError } from "./api";

export type KnowledgeDoc = {
  id: number;
  name: string;
  version: number;
  content: string;
  source: "kid" | "admin";
  conversationId: number | null;
  createdAt: string;
};

type Row = {
  id: string;
  name: string;
  version: number;
  content: string;
  source: "kid" | "admin";
  conversation_id: string | null;
  created_at: Date;
};

const toDoc = (r: Row): KnowledgeDoc => ({
  id: Number(r.id),
  name: r.name,
  version: r.version,
  content: r.content,
  source: r.source,
  conversationId: r.conversation_id ? Number(r.conversation_id) : null,
  createdAt: r.created_at.toISOString(),
});

export const MAX_DOC_CHARS = 200_000;

export function cleanDocName(name: string): string {
  const trimmed = name.trim().replace(/[\\/:*?"<>|\n\r]+/g, "-").slice(0, 80);
  if (!trimmed) throw new UserError("문서 이름을 적어 주세요.");
  return /\.[a-z0-9]+$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
}

/** 모든 문서의 모든 버전. 이름순, 새 버전 먼저 */
export async function listKnowledge(): Promise<KnowledgeDoc[]> {
  const sql = await db();
  const rows = await sql<Row[]>`SELECT * FROM knowledge_docs ORDER BY lower(name), version DESC`;
  return rows.map(toDoc);
}

/** 이름마다 가장 새 버전만. Claude에게 보낼 때 씁니다. */
export async function latestKnowledge(): Promise<KnowledgeDoc[]> {
  const sql = await db();
  const rows = await sql<Row[]>`
    SELECT DISTINCT ON (name) * FROM knowledge_docs ORDER BY name, version DESC`;
  return rows.map(toDoc);
}

/** 같은 이름이 있으면 다음 버전으로 저장합니다. 옛 버전은 지우지 않습니다. */
export async function saveKnowledge(input: {
  name: string;
  content: string;
  source: "kid" | "admin";
  conversationId?: number | null;
}): Promise<KnowledgeDoc> {
  const name = cleanDocName(input.name);
  if (!input.content.trim()) throw new UserError("문서 내용이 비어 있어요.");
  if (input.content.length > MAX_DOC_CHARS) throw new UserError("문서가 너무 길어요.");
  const sql = await db();
  // 동시에 저장하면 UNIQUE(name, version) 충돌이 날 수 있어 한 번 더 시도합니다.
  for (let attempt = 0; ; attempt++) {
    try {
      const [row] = await sql<Row[]>`
        INSERT INTO knowledge_docs (name, version, content, source, conversation_id)
        SELECT ${name}, COALESCE(MAX(version), 0) + 1, ${input.content}, ${input.source}, ${input.conversationId ?? null}
        FROM knowledge_docs WHERE name = ${name}
        RETURNING *`;
      return toDoc(row);
    } catch (e) {
      if (attempt >= 2) throw e;
    }
  }
}

export async function deleteKnowledge(id: number): Promise<void> {
  const sql = await db();
  await sql`DELETE FROM knowledge_docs WHERE id = ${id}`;
}
