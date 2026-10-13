import postgres from "postgres";

type Sql = postgres.Sql;
const g = globalThis as unknown as { __sql?: Sql; __schema?: Promise<void> };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  name TEXT,
  picture TEXT,
  token_enc TEXT NOT NULL,
  token_issued_at TIMESTAMPTZ NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  -- 이용 상태: active(이용 중) | paused(중지). 향후 정기결제 상태와 연결합니다.
  status TEXT NOT NULL DEFAULT 'active',
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  permalink TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL,
  parent_id TEXT,
  username TEXT,
  text TEXT NOT NULL DEFAULT '',
  permalink TEXT,
  is_mine BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  -- 다른 사람 댓글의 처리 상태: open(미답변) | replied(답변함) | dismissed(답 안 함)
  status TEXT NOT NULL DEFAULT 'open',
  extracted BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS comments_inbox ON comments (account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS comments_user ON comments (account_id, username);
CREATE INDEX IF NOT EXISTS comments_parent ON comments (parent_id);

CREATE TABLE IF NOT EXISTS people (
  id BIGSERIAL PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  -- 사용자가 삭제한 인물은 다시 정보를 추출하지 않습니다.
  forgotten BOOLEAN NOT NULL DEFAULT false,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  UNIQUE (account_id, username)
);

CREATE TABLE IF NOT EXISTS facts (
  id BIGSERIAL PRIMARY KEY,
  person_id BIGINT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  source_comment_id TEXT,
  source_text TEXT,
  stated_at TIMESTAMPTZ,
  -- current(현재 정보) | past(지난 정보)
  status TEXT NOT NULL DEFAULT 'current',
  -- ai(자동 추출) | user(직접 입력)
  origin TEXT NOT NULL DEFAULT 'ai',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facts_person ON facts (person_id, status);

-- 글 구조 태그 (글마다 한 번만 분류합니다)
CREATE TABLE IF NOT EXISTS post_tags (
  post_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  tags JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS post_tags_account ON post_tags (account_id);

-- 만든 리포트 (다시 열 때 비용이 들지 않도록 저장합니다)
CREATE TABLE IF NOT EXISTS reports (
  id BIGSERIAL PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reports_account ON reports (account_id, created_at DESC);

-- 글 분류에 쓸 모델: opus | haiku
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS tag_model TEXT NOT NULL DEFAULT 'opus';
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
