"use client";

import { useState } from "react";
import type { KnowledgeDoc } from "@/lib/knowledge";
import { copyText, formatDate } from "./api";
import { Markdown } from "./Markdown";

/** 한 문서의 모든 버전을 보여 줍니다. onDelete는 관리자 화면에서만 넘깁니다. */
export function KnowledgeViewer({
  versions,
  onClose,
  onDelete,
}: {
  versions: KnowledgeDoc[];
  onClose: () => void;
  onDelete?: (doc: KnowledgeDoc) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState(versions[0]?.id);
  const doc = versions.find((v) => v.id === selectedId) ?? versions[0];
  if (!doc) return null;
  const isText = /\.(md|markdown)$/i.test(doc.name);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={doc.name}>
        <div className="modal-head">
          <strong className="modal-title">{doc.name}</strong>
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="version-bar">
          <label>
            <span className="nowrap">버전</span>
            <select value={doc.id} onChange={(e) => setSelectedId(Number(e.target.value))}>
              {versions.map((v, i) => (
                <option key={v.id} value={v.id}>
                  {`버전 ${v.version}${i === 0 ? " (최신)" : ""} · ${formatDate(v.createdAt)} · ${v.source === "kid" ? "대화에서 저장" : "관리자 업로드"}`}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="chip" onClick={() => copyText(doc.content)}>
            복사
          </button>
          {onDelete && (
            <button
              type="button"
              className="chip danger"
              onClick={async () => {
                if (confirm(`${doc.name} 버전 ${doc.version}을 삭제할까요? 되돌릴 수 없습니다.`)) await onDelete(doc);
              }}
            >
              이 버전 삭제
            </button>
          )}
        </div>
        <div className="modal-body">{isText ? <Markdown text={doc.content} /> : <pre className="plain">{doc.content}</pre>}</div>
      </div>
    </div>
  );
}

/** 이름별로 묶습니다. 각 묶음은 새 버전이 먼저 옵니다. */
export function groupDocs(docs: KnowledgeDoc[]): KnowledgeDoc[][] {
  const map = new Map<string, KnowledgeDoc[]>();
  for (const d of docs) map.set(d.name, [...(map.get(d.name) ?? []), d]);
  return [...map.values()].map((v) => v.sort((a, b) => b.version - a.version));
}
