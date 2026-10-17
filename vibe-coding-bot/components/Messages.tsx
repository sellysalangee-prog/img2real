"use client";

import type { StoredMessage, UserPart } from "@/lib/conversations";
import { formatDate } from "./api";
import { Markdown, type SaveDoc } from "./Markdown";

export type ViewMessage = {
  key: string;
  role: "user" | "assistant";
  parts?: UserPart[];
  text?: string;
  excluded?: boolean;
  createdAt?: string;
  notice?: string;
};

export function toView(m: StoredMessage): ViewMessage {
  if (m.role === "user") return { key: `m${m.id}`, role: "user", parts: m.content, excluded: m.excluded, createdAt: m.createdAt };
  const text = m.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  return { key: `m${m.id}`, role: "assistant", text, createdAt: m.createdAt };
}

function UserBubble({ m }: { m: ViewMessage }) {
  const parts = m.parts ?? [];
  return (
    <div className={`bubble user${m.excluded ? " excluded" : ""}`}>
      {parts.some((p) => p.type === "attachment") && (
        <div className="attach-list">
          {parts.map((p) =>
            p.type === "attachment" ? (
              p.kind === "image" ? (
                <a key={p.id} href={`/api/attachments/${p.id}`} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="thumb" src={`/api/attachments/${p.id}`} alt={p.name} />
                </a>
              ) : (
                <a key={p.id} className="file-chip" href={`/api/attachments/${p.id}`} target="_blank" rel="noreferrer">
                  📄 {p.name}
                </a>
              )
            ) : null,
          )}
        </div>
      )}
      {parts.map((p, i) => (p.type === "text" ? <p key={i} className="user-text">{p.text}</p> : null))}
      {m.excluded && <div className="meta">이 메시지에는 답을 받지 못했어요</div>}
    </div>
  );
}

export function MessageList({
  messages,
  streamingText,
  waiting,
  onSaveDoc,
  showTime,
}: {
  messages: ViewMessage[];
  streamingText?: string | null;
  waiting?: boolean;
  onSaveDoc?: SaveDoc;
  showTime?: boolean;
}) {
  return (
    <div className="messages">
      {messages.map((m) => (
        <div key={m.key} className={`row ${m.role}`}>
          {m.role === "user" ? (
            <UserBubble m={m} />
          ) : (
            <div className="bubble assistant">
              <Markdown text={m.text ?? ""} onSaveDoc={onSaveDoc} />
              {m.notice && <div className="notice">{m.notice}</div>}
            </div>
          )}
          {showTime && m.createdAt && <div className="time">{formatDate(m.createdAt)}</div>}
        </div>
      ))}
      {streamingText != null && (
        <div className="row assistant">
          <div className="bubble assistant">
            {streamingText ? <Markdown text={streamingText} /> : <div className="thinking">{waiting ? "생각하는 중…" : ""}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
