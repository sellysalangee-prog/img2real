"use client";

import { useState } from "react";
import { INFLUENCE_TYPES } from "@/lib/influence";
import type { InfluenceTypeKey } from "@/lib/types";
import { api, errorMessage } from "./api";

/** 내가 직접 붙이는 기본 라벨 */
export const PRESET_LABELS = [
  { key: "지인", icon: "🤝" },
  { key: "관심", icon: "⭐" },
] as const;

export function labelIcon(label: string): string {
  return PRESET_LABELS.find((l) => l.key === label)?.icon ?? "🏷️";
}

export function isImportant(labels: string[]): boolean {
  return labels.length > 0;
}

export function InfluenceBadge({ type }: { type: InfluenceTypeKey }) {
  const info = INFLUENCE_TYPES[type];
  return (
    <span className={`badge-soft inf-${type}`} title={info.desc}>
      {info.label}
    </span>
  );
}

export function LabelBadges({ labels }: { labels: string[] }) {
  if (!labels.length) return null;
  return (
    <>
      {labels.map((l) => (
        <span key={l} className="badge-soft label">
          {labelIcon(l)} {l}
        </span>
      ))}
    </>
  );
}

/** 지인·관심 같은 라벨을 눌러서 붙이고 떼는 버튼 줄. custom이면 직접 입력도 할 수 있어요. */
export function LabelEditor({
  personId,
  labels,
  onChange,
  custom = false,
}: {
  personId: string;
  labels: string[];
  onChange: (labels: string[]) => void;
  custom?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");

  async function save(next: string[]) {
    setBusy(true);
    try {
      await api(`/api/people/${personId}`, { method: "PATCH", json: { labels: next } });
      onChange(next);
    } catch (e) {
      alert(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (l: string) => save(labels.includes(l) ? labels.filter((x) => x !== l) : [...labels, l]);
  const extra = labels.filter((l) => !PRESET_LABELS.some((p) => p.key === l));

  return (
    <div className="label-editor">
      {PRESET_LABELS.map((p) => (
        <button key={p.key} className={`label-toggle ${labels.includes(p.key) ? "on" : ""}`} onClick={() => toggle(p.key)} disabled={busy} aria-pressed={labels.includes(p.key)}>
          {p.icon} {p.key}
        </button>
      ))}
      {extra.map((l) => (
        <button key={l} className="label-toggle on" onClick={() => toggle(l)} disabled={busy} title="눌러서 떼기">
          🏷️ {l} ✕
        </button>
      ))}
      {custom && (
        <form
          className="label-add"
          onSubmit={(e) => {
            e.preventDefault();
            const v = text.trim();
            if (v && !labels.includes(v)) save([...labels, v]);
            setText("");
          }}
        >
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="직접 입력 (예: 고객)" maxLength={12} aria-label="라벨 추가" />
          <button className="btn ghost small" disabled={busy || !text.trim()}>
            추가
          </button>
        </form>
      )}
    </div>
  );
}
