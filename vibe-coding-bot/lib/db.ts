import postgres from "postgres";

type Sql = postgres.Sql;
const g = globalThis as unknown as { __sql?: Sql; __schema?: Promise<void> };

const SCHEMA = `
-- 지침(system_prompt), 아이 비밀번호(kid_password, 암호화) 등 key-value 설정
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 로그인 실패 기록 (접속 주소별). 5번 틀리면 locked_until까지 잠급니다.
CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  fails INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS conversations (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- content: user는 [{type:"text"} | {type:"attachment", id}], assistant는 API 응답 블록 그대로 저장합니다.
-- excluded: 답을 받지 못한 질문. 다음 요청부터 Claude에게 보내지 않습니다.
-- usage: 토큰 사용량. 나중에 비용 상한을 붙일 때 씁니다.
CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content JSONB NOT NULL,
  excluded BOOLEAN NOT NULL DEFAULT false,
  model TEXT,
  usage JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation ON messages (conversation_id, id);

-- kind: image | pdf | text
CREATE TABLE IF NOT EXISTS attachments (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT REFERENCES conversations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size INT NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 프로젝트 지식. 같은 이름으로 저장하면 version이 하나씩 올라가고, 옛 버전도 남습니다.
-- source: kid(아이가 대화에서 저장) | admin(관리자 업로드)
CREATE TABLE IF NOT EXISTS knowledge_docs (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  version INT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  conversation_id BIGINT REFERENCES conversations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);
`;

function connect(): Sql {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) throw new Error("환경 변수 DATABASE_URL이 설정되지 않았습니다.");
  return postgres(url, { max: 5, idle_timeout: 20, prepare: false, onnotice: () => {} });
}

/** 첫 호출 때 테이블을 만들고 연결을 돌려줍니다. */
export async function db(): Promise<Sql> {
  const sql = (g.__sql ??= connect());
  g.__schema ??= sql.unsafe(SCHEMA).then(() => undefined);
  try {
    await g.__schema;
  } catch (e) {
    g.__schema = undefined;
    throw e;
  }
  return sql;
}
