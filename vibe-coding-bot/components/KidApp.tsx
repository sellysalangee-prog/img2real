"use client";

import { upload } from "@vercel/blob/client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AttachmentInfo } from "@/lib/attachments";
import type { ConversationSummary, StoredMessage, UserPart } from "@/lib/conversations";
import type { KnowledgeDoc } from "@/lib/knowledge";
import { api, logout, sendJson } from "./api";
import { groupDocs, KnowledgeViewer } from "./KnowledgeViewer";
import { MessageList, toView, type ViewMessage } from "./Messages";

type Pending = AttachmentInfo & { previewUrl?: string };

const MAX_IMAGE_SIDE = 1568;
const FILE_ACCEPT = ".lua,.luau,.txt,.md,.json,.csv,.pdf,.xml,.log";
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const TEXT_EXT = /\.(lua|luau|txt|md|markdown|json|csv|xml|html|css|js|ts|py|toml|yaml|yml|log)$/i;

/** Blob에 올릴 형식. lua 같은 파일은 브라우저가 형식을 모르므로 text/plain으로 맞춥니다. */
function uploadType(file: File): string | null {
  if (IMAGE_TYPES.includes(file.type)) return file.type;
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "application/pdf";
  if (file.type.startsWith("text/") || TEXT_EXT.test(file.name)) return "text/plain";
  return null;
}

/** 큰 스크린샷은 Claude가 읽기 좋은 크기로 줄여서 올립니다. */
async function shrinkImage(file: File): Promise<File> {
  if (file.type === "image/gif") return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}

export function KidApp() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ViewMessage[]>([]);
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [viewer, setViewer] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [uploading, setUploading] = useState(0);
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadConversations = useCallback(async () => {
    const { conversations } = await api<{ conversations: ConversationSummary[] }>("/api/conversations");
    setConversations(conversations);
  }, []);
  const loadDocs = useCallback(async () => {
    const { docs } = await api<{ docs: KnowledgeDoc[] }>("/api/knowledge");
    setDocs(docs);
  }, []);

  useEffect(() => {
    loadConversations().catch((e) => setError(e.message));
    loadDocs().catch(() => {});
  }, [loadConversations, loadDocs]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streamingText]);

  async function openConversation(id: number) {
    if (sending) return;
    setSidebarOpen(false);
    setError(null);
    setCurrentId(id);
    setMessages([]);
    try {
      const { messages } = await api<{ messages: StoredMessage[] }>(`/api/conversations/${id}`);
      setMessages(messages.map(toView));
    } catch (e) {
      setError(e instanceof Error ? e.message : "대화를 불러오지 못했어요.");
    }
  }

  function newConversation() {
    if (sending) return;
    setSidebarOpen(false);
    setCurrentId(null);
    setMessages([]);
    setError(null);
  }

  async function addFiles(files: FileList | File[]) {
    setError(null);
    for (const original of Array.from(files)) {
      setUploading((n) => n + 1);
      try {
        const file = original.type.startsWith("image/") ? await shrinkImage(original) : original;
        const contentType = uploadType(file);
        if (!contentType) throw new Error("사진(png, jpg, gif, webp), PDF, 글자로 된 파일(lua, txt, md 등)만 올릴 수 있어요.");
        const blob = await upload(`attachments/${file.name.replace(/[^\w.\-가-힣]+/g, "_")}`, file, {
          access: "private",
          handleUploadUrl: "/api/attachments/upload",
          contentType,
        });
        const { attachment } = await sendJson<{ attachment: AttachmentInfo }>("/api/attachments", { url: blob.url, name: file.name });
        const previewUrl = attachment.kind === "image" ? URL.createObjectURL(file) : undefined;
        setPending((p) => [...p, { ...attachment, previewUrl }]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "파일을 올리지 못했어요.");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  async function send() {
    const text = input.trim();
    if ((!text && !pending.length) || sending || uploading) return;
    setSending(true);
    setError(null);
    setStreamingText("");
    const attachmentIds = pending.map((p) => p.id);
    setInput("");
    setPending([]);

    let full = "";
    let userKey: string | null = null;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: currentId, text, attachmentIds }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 401) window.location.href = "/";
        throw new Error(data.error ?? "보내지 못했어요.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as
            | { type: "conversation"; id: number; title: string }
            | { type: "user"; id: number; content: UserPart[] }
            | { type: "text"; text: string }
            | { type: "done"; messageId: number; notice?: string }
            | { type: "error"; message: string };
          if (event.type === "conversation") {
            setCurrentId(event.id);
          } else if (event.type === "user") {
            userKey = `m${event.id}`;
            setMessages((m) => [...m, { key: userKey!, role: "user", parts: event.content }]);
          } else if (event.type === "text") {
            full += event.text;
            setStreamingText(full);
          } else if (event.type === "done") {
            setMessages((m) => [...m, { key: `m${event.messageId}`, role: "assistant", text: full, notice: event.notice }]);
          } else if (event.type === "error") {
            const key = userKey;
            setMessages((m) => m.map((x) => (x.key === key ? { ...x, excluded: true } : x)));
            setError(event.message);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "보내지 못했어요.");
      if (!userKey) setInput(text);
    } finally {
      setStreamingText(null);
      setSending(false);
      loadConversations().catch(() => {});
    }
  }

  async function saveDoc(name: string, content: string) {
    const { doc } = await sendJson<{ doc: KnowledgeDoc }>("/api/knowledge", { name, content, conversationId: currentId });
    loadDocs().catch(() => {});
    return doc;
  }

  const groups = groupDocs(docs);
  const viewerVersions = viewer ? groups.find((g) => g[0].name === viewer) : undefined;
  const title = conversations.find((c) => c.id === currentId)?.title ?? "새 대화";

  return (
    <div className="app">
      <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
        <button type="button" className="btn primary block" onClick={newConversation} disabled={sending}>
          + 새 대화
        </button>

        <section className="side-section">
          <h2>지난 대화</h2>
          {conversations.length === 0 && <p className="muted small">아직 대화가 없어요</p>}
          <ul className="side-list">
            {conversations.map((c) => (
              <li key={c.id}>
                <button type="button" className={`side-item${c.id === currentId ? " active" : ""}`} onClick={() => openConversation(c.id)}>
                  {c.title}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="side-section">
          <h2>프로젝트 지식</h2>
          {groups.length === 0 && <p className="muted small">저장된 문서가 없어요</p>}
          <ul className="side-list">
            {groups.map((g) => (
              <li key={g[0].name}>
                <button type="button" className="side-item" onClick={() => setViewer(g[0].name)}>
                  📘 {g[0].name}
                  {g.length > 1 && <span className="badge">버전 {g[0].version}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <button type="button" className="btn ghost block" onClick={logout}>
          나가기
        </button>
      </aside>
      {sidebarOpen && <div className="scrim" onClick={() => setSidebarOpen(false)} />}

      <main className="main">
        <header className="topbar">
          <button type="button" className="menu-btn" aria-label="메뉴" onClick={() => setSidebarOpen(true)}>
            ☰
          </button>
          <span className="topbar-title">{title}</span>
        </header>

        <div className="scroll">
          {messages.length === 0 && streamingText == null ? (
            <div className="empty">
              <h1>무엇을 만들어 볼까?</h1>
              <p className="muted">만들고 싶은 게임이나 고치고 싶은 오류를 말해 줘. 스크린샷을 올려도 돼.</p>
            </div>
          ) : (
            <MessageList messages={messages} streamingText={streamingText} waiting={sending} onSaveDoc={saveDoc} />
          )}
          <div ref={bottomRef} />
        </div>

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          {error && <div className="err composer-err">{error}</div>}
          {(pending.length > 0 || uploading > 0) && (
            <div className="pending">
              {pending.map((p) => (
                <span key={p.id} className="pending-item">
                  {p.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.previewUrl} alt={p.name} />
                  ) : (
                    <span className="file-chip">📄 {p.name}</span>
                  )}
                  <button type="button" aria-label="빼기" onClick={() => setPending((list) => list.filter((x) => x.id !== p.id))}>
                    ×
                  </button>
                </span>
              ))}
              {uploading > 0 && <span className="muted small">올리는 중…</span>}
            </div>
          )}
          <div className="composer-row">
            <button type="button" className="icon-btn" title="사진 첨부" onClick={() => imageInput.current?.click()}>
              🖼️
            </button>
            <button type="button" className="icon-btn" title="파일 올리기" onClick={() => fileInput.current?.click()}>
              📎
            </button>
            <textarea
              value={input}
              rows={1}
              placeholder="메시지를 적어 줘"
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => {
                const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
                if (images.length) {
                  e.preventDefault();
                  addFiles(images);
                }
              }}
              onKeyDown={(e) => {
                // 컴퓨터에서는 Enter로 보내고 Shift+Enter로 줄을 바꿉니다. 휴대폰에서는 보내기 버튼을 씁니다.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button type="submit" className="btn primary" disabled={sending || uploading > 0 || (!input.trim() && !pending.length)}>
              {sending ? "…" : "보내기"}
            </button>
          </div>
          <input
            ref={imageInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={fileInput}
            type="file"
            accept={FILE_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </form>
      </main>

      {viewerVersions && <KnowledgeViewer versions={viewerVersions} onClose={() => setViewer(null)} />}
    </div>
  );
}
