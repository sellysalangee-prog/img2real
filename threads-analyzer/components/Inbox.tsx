"use client";

import { useCallback, useEffect, useState } from "react";
import type { CheckResult, InboxItem } from "@/lib/types";
import { api, errorMessage } from "./api";
import { date } from "./format";
import PersonCard from "./PersonCard";

const FILTERS = [
  { key: "open", label: "답할 댓글" },
  { key: "replied", label: "답한 댓글" },
  { key: "dismissed", label: "답 안 함" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

type SyncResult = { newComments: number; peopleUpdated: number; factsAdded: number; remaining: number; errors: string[] };

export default function Inbox({ onOpenPerson }: { onOpenPerson: (id: string) => void }) {
  const [filter, setFilter] = useState<FilterKey>("open");
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (f: FilterKey) => {
    setError(null);
    try {
      const res = await api<{ items: InboxItem[]; lastSyncedAt: string | null }>(`/api/inbox?status=${f}`);
      setItems(res.items);
      setLastSyncedAt(res.lastSyncedAt);
      return res;
    } catch (e) {
      setError(errorMessage(e));
      return null;
    }
  }, []);

  async function sync() {
    setSyncing(true);
    setNotice(null);
    try {
      const r = await api<SyncResult>("/api/sync", { method: "POST" });
      const parts = [`새 댓글 ${r.newComments}개`, `새로 기억한 정보 ${r.factsAdded}개`];
      if (r.remaining) parts.push(`아직 정리 못 한 사람 ${r.remaining}명 (한 번 더 누르면 이어서 정리해요)`);
      if (r.errors.length) parts.push(`일부 오류: ${r.errors[0]}`);
      setNotice(parts.join(" · "));
      await load(filter);
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    setItems(null);
    load(filter).then((res) => {
      // 처음 쓰는 계정이면 바로 댓글을 모읍니다.
      if (res && !res.lastSyncedAt && filter === "open") sync();
    });
  }, [filter, load]);

  function remove(id: string) {
    setItems((prev) => prev?.filter((i) => i.id !== id) ?? null);
  }

  return (
    <div className="content">
      <div className="toolbar">
        <div className="segmented grow" role="tablist" aria-label="댓글 상태">
          {FILTERS.map((f) => (
            <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="sync-row">
        <span className="tiny muted">{lastSyncedAt ? `마지막 수집 ${date(lastSyncedAt)}` : "아직 수집 전이에요"}</span>
        <button className="btn ghost small" onClick={sync} disabled={syncing}>
          {syncing ? "댓글 모으는 중…" : "새 댓글 가져오기"}
        </button>
      </div>
      {syncing && <p className="tiny muted">댓글을 모으고 사람별 정보를 정리하고 있어요. 처음엔 1~2분 걸릴 수 있어요.</p>}
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      {items === null && !error && <div className="skeleton" />}
      {items?.length === 0 && (
        <p className="muted empty">{filter === "open" ? "답할 댓글이 없어요. 다 챙기셨네요!" : "해당하는 댓글이 없어요."}</p>
      )}
      {items?.map((item) => (
        <InboxCard key={item.id} item={item} onOpenPerson={onOpenPerson} onDone={remove} />
      ))}
    </div>
  );
}

function InboxCard({ item, onOpenPerson, onDone }: { item: InboxItem; onOpenPerson: (id: string) => void; onDone: (id: string) => void }) {
  const [draft, setDraft] = useState("");
  const [check, setCheck] = useState<{ draft: string; result: CheckResult } | null>(null);
  const [busy, setBusy] = useState<"check" | "post" | "status" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);

  const checkedCurrent = check?.draft === draft.trim();

  async function runCheck() {
    setBusy("check");
    setError(null);
    try {
      const result = await api<CheckResult>(`/api/comments/${item.id}/check`, { method: "POST", json: { draft } });
      setCheck({ draft: draft.trim(), result });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  function applyRevision() {
    if (!check) return;
    setDraft(check.result.revised);
    setCheck({ draft: check.result.revised.trim(), result: { verdict: "ok", issues: [], revised: check.result.revised } });
  }

  async function post() {
    if (!checkedCurrent && !window.confirm("아직 검사하지 않은 답글이에요. 그대로 올릴까요?")) return;
    setBusy("post");
    setError(null);
    try {
      await api(`/api/comments/${item.id}/reply`, { method: "POST", json: { text: draft } });
      setPosted(true);
      setTimeout(() => onDone(item.id), 1200);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(status: "open" | "dismissed") {
    setBusy("status");
    try {
      await api(`/api/comments/${item.id}`, { method: "PATCH", json: { status } });
      onDone(item.id);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  return (
    <article className="card inbox-card">
      <p className="context tiny muted">
        원글: {item.post.text.slice(0, 60) || "(본문 없음)"}
        {item.post.text.length > 60 && "…"}
      </p>
      {item.myParentText && <p className="context tiny">↳ 내 답글: {item.myParentText.slice(0, 80)}</p>}

      <div className="comment">
        <div className="comment-head">
          <b>{item.person ? `@${item.person.username}` : "비공개 계정"}</b>
          <span className="tiny muted">{date(item.createdAt)}</span>
        </div>
        <p className="comment-text">{item.text || <span className="muted">(내용 없음)</span>}</p>
      </div>

      <PersonCard person={item.person} onOpen={onOpenPerson} />

      {item.status === "open" ? (
        posted ? (
          <p className="ok-msg">답글을 올렸어요 ✓</p>
        ) : (
          <div className="reply-box">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="답글 쓰기"
              rows={3}
              maxLength={500}
              aria-label="답글"
            />
            {check && checkedCurrent && <CheckView result={check.result} onApply={applyRevision} />}
            {check && !checkedCurrent && <p className="tiny muted">글을 고쳤어요. 올리기 전에 다시 검사해 보세요.</p>}
            {error && <p className="error tiny">{error}</p>}
            <div className="reply-actions">
              <button className="btn ghost small" onClick={() => setStatus("dismissed")} disabled={busy !== null}>
                답 안 함
              </button>
              <span className="grow" />
              <button className="btn ghost small" onClick={runCheck} disabled={!draft.trim() || busy !== null}>
                {busy === "check" ? "검사 중…" : "실수 검사"}
              </button>
              <button className="btn primary small" onClick={post} disabled={!draft.trim() || busy !== null}>
                {busy === "post" ? "올리는 중…" : "올리기"}
              </button>
            </div>
          </div>
        )
      ) : (
        <div className="reply-actions">
          {item.permalink && (
            <a className="link tiny" href={item.permalink} target="_blank" rel="noreferrer">
              Threads에서 보기 →
            </a>
          )}
          <span className="grow" />
          {item.status === "dismissed" && (
            <button className="btn ghost small" onClick={() => setStatus("open")} disabled={busy !== null}>
              답할 댓글로 되돌리기
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function CheckView({ result, onApply }: { result: CheckResult; onApply: () => void }) {
  if (result.verdict === "ok" || !result.issues.length) return <p className="ok-msg">실수가 보이지 않아요. 올려도 좋아요 ✓</p>;
  return (
    <div className="check">
      <p className="check-title">확인해 보세요</p>
      <ul>
        {result.issues.map((issue, i) => (
          <li key={i}>
            <p>
              <span className="quote">“{issue.quote}”</span> {issue.problem}
            </p>
            <p className="tiny">→ {issue.suggestion}</p>
          </li>
        ))}
      </ul>
      <p className="tiny muted">수정안</p>
      <p className="revised">{result.revised}</p>
      <button className="btn primary small" onClick={onApply}>
        수정안으로 바꾸기
      </button>
    </div>
  );
}
