"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConversationSummary, StoredMessage } from "@/lib/conversations";
import type { KnowledgeDoc } from "@/lib/knowledge";
import { api, formatDate, logout, sendJson } from "./api";
import { groupDocs, KnowledgeViewer } from "./KnowledgeViewer";
import { MessageList, toView } from "./Messages";

type Tab = "conversations" | "guidelines" | "knowledge" | "password";
const TABS: { key: Tab; label: string }[] = [
  { key: "conversations", label: "대화 기록" },
  { key: "guidelines", label: "지침" },
  { key: "knowledge", label: "프로젝트 지식" },
  { key: "password", label: "아이 비밀번호" },
];

type Settings = { guidelines: string; kidPassword: string | null };

function Conversations() {
  const [list, setList] = useState<ConversationSummary[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ conversations: ConversationSummary[] }>("/api/conversations")
      .then((d) => setList(d.conversations))
      .catch((e) => setError(e.message));
  }, []);

  async function open(id: number) {
    setSelected(id);
    setMessages([]);
    try {
      setMessages((await api<{ messages: StoredMessage[] }>(`/api/conversations/${id}`)).messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오지 못했습니다.");
    }
  }

  if (selected !== null) {
    const conv = list.find((c) => c.id === selected);
    return (
      <div className="panel">
        <div className="panel-head">
          <button type="button" className="btn" onClick={() => setSelected(null)}>
            ← 목록
          </button>
          <strong>{conv?.title}</strong>
        </div>
        {error && <p className="err">{error}</p>}
        <MessageList messages={messages.map(toView)} showTime />
      </div>
    );
  }

  return (
    <div className="panel">
      {error && <p className="err">{error}</p>}
      {list.length === 0 && <p className="muted">아직 대화가 없습니다.</p>}
      <ul className="table-list">
        {list.map((c) => (
          <li key={c.id}>
            <button type="button" className="table-row" onClick={() => open(c.id)}>
              <span className="row-title">{c.title}</span>
              <span className="muted small">
                메시지 {c.messageCount}개 · 마지막 {formatDate(c.updatedAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Guidelines({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const [text, setText] = useState(settings.guidelines);
  const [status, setStatus] = useState<string | null>(null);
  const changed = text !== settings.guidelines;

  return (
    <div className="panel">
      <p className="muted small">
        매 질문마다 이 지침이 Claude에게 먼저 전달되고, 그 뒤에 프로젝트 지식 문서(이름마다 최신 버전)가 붙습니다. 지침은 이
        화면에서 입력한 내용만 DB에 저장되며, 지침이 비어 있으면 아이 화면에서 질문을 보낼 수 없습니다.
      </p>
      <p className="muted small">
        &quot;프로젝트에 저장&quot; 버튼은 Claude가 문서를 ```markdown 파일이름.md 로 시작하는 코드 블록 하나에 담아 쓸 때 표시됩니다.
        버튼이 필요하면 이 형식을 지침에 적어 주세요.
      </p>
      <textarea className="editor" value={text} onChange={(e) => setText(e.target.value)} rows={18} />
      <div className="actions">
        <button
          type="button"
          className="btn primary"
          disabled={!changed}
          onClick={async () => {
            try {
              const s = await sendJson<Settings>("/api/admin/settings", { guidelines: text }, "PUT");
              onSaved({ ...settings, ...s });
              setStatus("저장했습니다.");
            } catch (e) {
              setStatus(e instanceof Error ? e.message : "저장하지 못했습니다.");
            }
          }}
        >
          저장
        </button>
        {changed && <span className="muted small">저장하지 않은 변경이 있습니다</span>}
        {status && !changed && <span className="ok">{status}</span>}
      </div>
    </div>
  );
}

function Knowledge() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [viewer, setViewer] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setDocs((await api<{ docs: KnowledgeDoc[] }>("/api/knowledge")).docs);
  }, []);
  useEffect(() => {
    load().catch((e) => setStatus(e.message));
  }, [load]);

  async function save(docName: string, docContent: string) {
    const { doc } = await sendJson<{ doc: KnowledgeDoc }>("/api/knowledge", { name: docName, content: docContent });
    await load();
    return doc;
  }

  async function remove(doc: KnowledgeDoc) {
    await api(`/api/knowledge/${doc.id}`, { method: "DELETE" });
    await load();
    const rest = docs.filter((d) => d.name === doc.name && d.id !== doc.id);
    if (!rest.length) setViewer(null);
  }

  const groups = groupDocs(docs);
  const viewerVersions = viewer ? groups.find((g) => g[0].name === viewer) : undefined;

  return (
    <div className="panel">
      <section className="card">
        <h3>파일 업로드</h3>
        <p className="muted small">md, txt, lua 같은 글자 파일을 올립니다. 같은 이름이 있으면 새 버전으로 저장되고 옛 버전은 남습니다.</p>
        <input
          type="file"
          accept=".md,.markdown,.txt,.lua,.luau,.json,.csv"
          multiple
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            for (const f of files) {
              try {
                const doc = await save(f.name, await f.text());
                setStatus(`${doc.name} 버전 ${doc.version}을 저장했습니다.`);
              } catch (err) {
                setStatus(err instanceof Error ? err.message : "업로드하지 못했습니다.");
              }
            }
          }}
        />
      </section>

      <section className="card">
        <h3>직접 작성</h3>
        <input placeholder="문서 이름 (예: game-plan.md)" value={name} onChange={(e) => setName(e.target.value)} />
        <textarea className="editor" rows={8} placeholder="내용" value={content} onChange={(e) => setContent(e.target.value)} />
        <div className="actions">
          <button
            type="button"
            className="btn primary"
            disabled={!name.trim() || !content.trim()}
            onClick={async () => {
              try {
                const doc = await save(name, content);
                setStatus(`${doc.name} 버전 ${doc.version}을 저장했습니다.`);
                setName("");
                setContent("");
              } catch (err) {
                setStatus(err instanceof Error ? err.message : "저장하지 못했습니다.");
              }
            }}
          >
            저장
          </button>
        </div>
      </section>

      {status && <p className="ok">{status}</p>}

      <section className="card">
        <h3>저장된 문서</h3>
        {groups.length === 0 && <p className="muted">아직 문서가 없습니다.</p>}
        <ul className="table-list">
          {groups.map((g) => (
            <li key={g[0].name}>
              <button type="button" className="table-row" onClick={() => setViewer(g[0].name)}>
                <span className="row-title">{g[0].name}</span>
                <span className="muted small">
                  최신 버전 {g[0].version} · 버전 {g.length}개 보관 · {formatDate(g[0].createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {viewerVersions && <KnowledgeViewer key={viewer} versions={viewerVersions} onClose={() => setViewer(null)} onDelete={remove} />}
    </div>
  );
}

function Password({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div className="panel">
      <section className="card">
        <h3>현재 아이 비밀번호</h3>
        <p className="big-text">{settings.kidPassword ?? "아직 정하지 않았습니다"}</p>
        <p className="muted small">대소문자를 구분하지 않습니다. 영문과 숫자만 쓸 수 있습니다.</p>
      </section>
      <section className="card">
        <h3>바꾸기</h3>
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="새 비밀번호" autoCapitalize="none" maxLength={40} />
        <div className="actions">
          <button
            type="button"
            className="btn primary"
            disabled={!value.trim()}
            onClick={async () => {
              try {
                const s = await sendJson<Settings>("/api/admin/settings", { kidPassword: value }, "PUT");
                onSaved({ ...settings, ...s });
                setValue("");
                setStatus("바꿨습니다.");
              } catch (e) {
                setStatus(e instanceof Error ? e.message : "바꾸지 못했습니다.");
              }
            }}
          >
            저장
          </button>
          {status && <span className="ok">{status}</span>}
        </div>
      </section>
    </div>
  );
}

export function AdminApp() {
  const [tab, setTab] = useState<Tab>("conversations");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Settings>("/api/admin/settings")
      .then(setSettings)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="admin">
      <header className="admin-head">
        <strong>관리자</strong>
        <button type="button" className="btn ghost" onClick={logout}>
          나가기
        </button>
      </header>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`tab${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>
      {error && <p className="err">{error}</p>}
      {tab === "conversations" && <Conversations />}
      {tab === "knowledge" && <Knowledge />}
      {settings && tab === "guidelines" && <Guidelines settings={settings} onSaved={setSettings} />}
      {settings && tab === "password" && <Password settings={settings} onSaved={setSettings} />}
    </div>
  );
}
