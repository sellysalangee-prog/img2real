"use client";

import { createContext, useContext, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { KnowledgeDoc } from "@/lib/knowledge";
import { copyText } from "./api";

export type SaveDoc = (name: string, content: string) => Promise<KnowledgeDoc>;

type HastNode = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; data?: { meta?: string }; children?: HastNode[] };

function textOf(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

/** ```markdown game-plan.md 처럼 언어 뒤에 적힌 파일 이름을 찾고, 없으면 첫 제목으로 정합니다. */
function guessDocName(meta: string | undefined, content: string): string {
  const fromMeta = meta?.match(/[^\s"'=]+\.(md|markdown|txt)/i)?.[0];
  if (fromMeta) return fromMeta;
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading ? `${heading.slice(0, 40)}.md` : "document.md";
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="chip"
      onClick={async () => {
        await copyText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "복사했어요" : "복사"}
    </button>
  );
}

function SaveToProject({ initialName, content, onSave }: { initialName: string; content: string; onSave: SaveDoc }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<KnowledgeDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (saved) {
    return (
      <div className="save-row">
        <span className="ok">프로젝트에 저장했어요: {saved.name} (버전 {saved.version})</span>
      </div>
    );
  }
  if (!open) {
    return (
      <div className="save-row">
        <button type="button" className="btn primary" onClick={() => setOpen(true)}>
          프로젝트에 저장
        </button>
      </div>
    );
  }
  return (
    <form
      className="save-row"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          setSaved(await onSave(name, content));
        } catch (err) {
          setError(err instanceof Error ? err.message : "저장하지 못했어요.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="save-label">
        문서 이름
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </label>
      <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
        {busy ? "저장 중…" : "저장"}
      </button>
      <button type="button" className="btn" onClick={() => setOpen(false)}>
        취소
      </button>
      {error && <span className="err">{error}</span>}
    </form>
  );
}

/** components를 렌더마다 새로 만들면 코드 블록이 다시 마운트되어 입력 중이던 상태가 사라지므로, 저장 함수는 context로 넘깁니다. */
const SaveDocContext = createContext<SaveDoc | undefined>(undefined);

const components: Components = {
  pre: function Pre({ node }) {
    const onSaveDoc = useContext(SaveDocContext);
    const code = (node as unknown as HastNode)?.children?.find((c) => c.tagName === "code");
    const classes = (code?.properties?.className as string[] | undefined) ?? [];
    const lang = classes.find((c) => c.startsWith("language-"))?.slice(9) ?? "";
    const meta = code?.data?.meta;
    const content = textOf(code).replace(/\n$/, "");
    const isDoc = lang === "markdown" || lang === "md";

    if (isDoc) {
      const name = guessDocName(meta, content);
      return (
        <div className="doc-card">
          <div className="code-head">
            <span className="code-lang">문서 · {name}</span>
            <CopyButton text={content} />
          </div>
          <div className="doc-body">
            <SaveDocContext.Provider value={undefined}>
              <Markdown text={content} />
            </SaveDocContext.Provider>
          </div>
          {onSaveDoc && <SaveToProject initialName={name} content={content} onSave={onSaveDoc} />}
        </div>
      );
    }
    return (
      <div className="code-card">
        <div className="code-head">
          <span className="code-lang">{meta ? `${lang} · ${meta}` : lang || "코드"}</span>
          <CopyButton text={content} />
        </div>
        <pre>
          <code>{content}</code>
        </pre>
      </div>
    );
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
};

const remarkPlugins = [remarkGfm];

export function Markdown({ text, onSaveDoc }: { text: string; onSaveDoc?: SaveDoc }) {
  const md = (
    <div className="md">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
  return onSaveDoc ? <SaveDocContext.Provider value={onSaveDoc}>{md}</SaveDocContext.Provider> : md;
}
