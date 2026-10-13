"use client";

import { useEffect, useMemo, useState } from "react";
import type { Fact, FactCategoryKey, PersonDetail, PersonSummary } from "@/lib/types";
import { api, errorMessage } from "./api";
import { date } from "./format";
import { INFLUENCE_TYPES } from "@/lib/influence";
import { InfluenceBadge, LabelBadges, LabelEditor, PRESET_LABELS } from "./labels";

const CATEGORIES: { key: FactCategoryKey; label: string }[] = [
  { key: "basic", label: "기본" },
  { key: "life", label: "생활" },
  { key: "interest", label: "관심사" },
  { key: "recent", label: "근황" },
  { key: "other", label: "기타" },
];

export default function People({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string | null) => void }) {
  if (selectedId) return <PersonView id={selectedId} onBack={() => onSelect(null)} />;
  return <PeopleList onSelect={onSelect} />;
}

function PeopleList({ onSelect }: { onSelect: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<PersonSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ people: PersonSummary[] }>(`/api/people?q=${encodeURIComponent(q)}`)
        .then((r) => {
          setPeople(r.people);
          setError(null);
        })
        .catch((e) => setError(errorMessage(e)));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const [chip, setChip] = useState<string>("all");
  const chips = useMemo(() => {
    const list = people ?? [];
    const base = [{ key: "all", label: "전체", count: list.length }];
    const labelChips = PRESET_LABELS.map((l) => ({ key: `label:${l.key}`, label: `${l.icon} ${l.key}`, count: list.filter((p) => p.labels.includes(l.key)).length }));
    const typeChips = (Object.keys(INFLUENCE_TYPES) as (keyof typeof INFLUENCE_TYPES)[]).map((t) => ({
      key: `type:${t}`,
      label: INFLUENCE_TYPES[t].label,
      count: list.filter((p) => p.influence === t).length,
    }));
    return [...base, ...labelChips, ...typeChips].filter((c) => c.key === "all" || c.count > 0);
  }, [people]);
  const filtered = useMemo(() => {
    if (!people) return null;
    if (chip.startsWith("label:")) return people.filter((p) => p.labels.includes(chip.slice(6)));
    if (chip.startsWith("type:")) return people.filter((p) => p.influence === chip.slice(5));
    return people;
  }, [people, chip]);

  return (
    <div className="content">
      <input className="search" type="search" placeholder="아이디, 정보, 메모, 라벨로 찾기 (예: 캐나다)" value={q} onChange={(e) => setQ(e.target.value)} />
      {people && people.length > 0 && (
        <div className="chip-filter" role="tablist" aria-label="사람 거르기">
          {chips.map((c) => (
            <button key={c.key} role="tab" aria-selected={chip === c.key} onClick={() => setChip(c.key)}>
              {c.label} <span className="muted">{c.count}</span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {people === null && !error && <div className="skeleton" />}
      {people?.length === 0 && <p className="muted empty">{q ? "찾는 사람이 없어요." : "아직 기억한 사람이 없어요. 댓글함에서 새 댓글을 가져와 보세요."}</p>}
      <ul className="people">
        {filtered?.map((p) => (
          <li key={p.id}>
            <button className="person-row" onClick={() => onSelect(p.id)}>
              <div className="person-row-head">
                <b>@{p.username}</b>
                <LabelBadges labels={p.labels} />
                {p.influence !== "newcomer" && <InfluenceBadge type={p.influence} />}
                {p.openCount > 0 && <span className="badge">답할 댓글 {p.openCount}</span>}
                <span className="tiny muted right">{date(p.lastSeenAt).split(" ").slice(0, 2).join(" ")}</span>
              </div>
              {p.facts.length ? (
                <p className="tiny person-facts">
                  {p.facts
                    .slice(0, 4)
                    .map((f) => `${f.label} ${f.value}`)
                    .join(" · ")}
                </p>
              ) : (
                <p className="tiny muted">
                  {p.pending ? "아직 정리 전" : "본인 이야기 없음"} · 대화 {p.commentCount}번
                </p>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PersonView({ id, onBack }: { id: string; onBack: () => void }) {
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [notesState, setNotesState] = useState<"idle" | "saving" | "saved">("idle");
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    setPerson(null);
    api<PersonDetail>(`/api/people/${id}`)
      .then((p) => {
        setPerson(p);
        setNotes(p.notes);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [id]);

  function replaceFact(f: Fact) {
    setPerson((p) => (p ? { ...p, facts: p.facts.map((x) => (x.id === f.id ? f : x)) } : p));
  }
  function removeFact(factId: string) {
    setPerson((p) => (p ? { ...p, facts: p.facts.filter((x) => x.id !== factId) } : p));
  }

  async function saveNotes() {
    if (!person || notes === person.notes) return;
    setNotesState("saving");
    try {
      await api(`/api/people/${id}`, { method: "PATCH", json: { notes } });
      setPerson({ ...person, notes });
      setNotesState("saved");
    } catch (e) {
      setError(errorMessage(e));
      setNotesState("idle");
    }
  }

  async function forget() {
    if (!person || !window.confirm(`@${person.username}님에 대해 기억한 정보와 메모를 모두 지울까요? 앞으로도 이 사람의 정보는 기억하지 않아요.`)) return;
    try {
      await api(`/api/people/${id}`, { method: "DELETE" });
      onBack();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (error)
    return (
      <div className="content">
        <button className="link-btn" onClick={onBack}>
          ← 사람 목록
        </button>
        <p className="error">{error}</p>
      </div>
    );
  if (!person)
    return (
      <div className="content">
        <div className="skeleton" />
      </div>
    );

  const current = person.facts.filter((f) => f.status === "current");
  const past = person.facts.filter((f) => f.status === "past");

  return (
    <div className="content">
      <button className="link-btn" onClick={onBack}>
        ← 사람 목록
      </button>

      <section className="card">
        <div className="card-head">
          <h3>@{person.username}</h3>
          <a className="link tiny" href={`https://www.threads.net/@${person.username}`} target="_blank" rel="noreferrer">
            프로필 →
          </a>
        </div>
        <p className="tiny muted">
          처음 대화 {date(person.firstSeenAt)} · 마지막 대화 {date(person.lastSeenAt)}
        </p>

        <div className="fact-group">
          <h4>내가 붙인 라벨</h4>
          <LabelEditor personId={person.id} labels={person.labels} onChange={(labels) => setPerson({ ...person, labels })} custom />
        </div>

        <div className="fact-group">
          <h4>영향력</h4>
          <p>
            <InfluenceBadge type={person.influence.type} /> <span className="tiny muted">{INFLUENCE_TYPES[person.influence.type].desc}</span>
          </p>
          <ul className="influence-stats tiny">
            <li>
              <b>{person.influence.comments}</b> 댓글
            </li>
            <li>
              <b>{person.influence.pulledIn}</b>명 끌어들임
            </li>
            <li>
              <b>{person.influence.started}</b>번 대화 시작
            </li>
            <li>
              <b>{person.influence.joinedOthers}</b>번 남의 대화 참여
            </li>
            <li>
              <b>{person.influence.withMe}</b>번 나와 주고받음
            </li>
          </ul>
        </div>

        {CATEGORIES.map((c) => {
          const facts = current.filter((f) => f.category === c.key);
          if (!facts.length) return null;
          return (
            <div key={c.key} className="fact-group">
              <h4>{c.label}</h4>
              {facts.map((f) => (
                <FactRow key={f.id} fact={f} onChange={replaceFact} onDelete={removeFact} />
              ))}
            </div>
          );
        })}
        {!current.length && <p className="muted empty">아직 기억한 정보가 없어요. 직접 추가할 수도 있어요.</p>}

        <AddFact personId={person.id} onAdd={(f) => setPerson({ ...person, facts: [...person.facts, f] })} />

        {past.length > 0 && (
          <div className="fact-group">
            <button className="link-btn tiny" onClick={() => setShowPast((v) => !v)}>
              {showPast ? "지난 정보 접기" : `지난 정보 ${past.length}개 보기`}
            </button>
            {showPast && past.map((f) => <FactRow key={f.id} fact={f} onChange={replaceFact} onDelete={removeFact} />)}
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h3>메모</h3>
          <span className="tiny muted">{notesState === "saving" ? "저장 중…" : notesState === "saved" ? "저장됨" : ""}</span>
        </div>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setNotesState("idle");
          }}
          onBlur={saveNotes}
          rows={3}
          maxLength={2000}
          placeholder="이 사람에 대해 기억하고 싶은 것 (나만 볼 수 있어요)"
          aria-label="메모"
        />
      </section>

      <section className="card">
        <h3>주고받은 댓글</h3>
        <Conversation items={person.conversation} />
      </section>

      <button className="btn danger-ghost small" onClick={forget}>
        이 사람 기억 지우기
      </button>
    </div>
  );
}

function FactRow({ fact, onChange, onDelete }: { fact: Fact; onChange: (f: Fact) => void; onDelete: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(fact.value);
  const [busy, setBusy] = useState(false);

  async function patch(body: Partial<Pick<Fact, "value" | "status">>) {
    setBusy(true);
    try {
      onChange(await api<Fact>(`/api/facts/${fact.id}`, { method: "PATCH", json: body }));
      setEditing(false);
    } catch (e) {
      alert(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`"${fact.label}: ${fact.value}" 정보를 지울까요?`)) return;
    try {
      await api(`/api/facts/${fact.id}`, { method: "DELETE" });
      onDelete(fact.id);
    } catch (e) {
      alert(errorMessage(e));
    }
  }

  return (
    <div className={`fact ${fact.status === "past" ? "past" : ""}`}>
      <div className="fact-main">
        <span className="fact-label">{fact.label}</span>
        {editing ? (
          <input className="fact-input" value={value} onChange={(e) => setValue(e.target.value)} maxLength={300} autoFocus aria-label={fact.label} />
        ) : (
          <span className="fact-value">{fact.value}</span>
        )}
      </div>
      {fact.sourceText ? (
        <p className="fact-source tiny muted">
          “{fact.sourceText.slice(0, 120)}
          {fact.sourceText.length > 120 && "…"}” {fact.statedAt && `· ${fact.statedAt.slice(0, 10)}`}
        </p>
      ) : (
        <p className="fact-source tiny muted">직접 입력{fact.statedAt && ` · ${fact.statedAt.slice(0, 10)}`}</p>
      )}
      <div className="fact-actions">
        {editing ? (
          <>
            <button className="link-btn tiny" onClick={() => patch({ value })} disabled={busy || !value.trim()}>
              저장
            </button>
            <button className="link-btn tiny muted" onClick={() => setEditing(false)}>
              취소
            </button>
          </>
        ) : (
          <>
            <button className="link-btn tiny" onClick={() => setEditing(true)}>
              수정
            </button>
            <button className="link-btn tiny" onClick={() => patch({ status: fact.status === "current" ? "past" : "current" })} disabled={busy}>
              {fact.status === "current" ? "지난 정보로" : "현재 정보로"}
            </button>
            <button className="link-btn tiny danger" onClick={remove}>
              삭제
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function AddFact({ personId, onAdd }: { personId: string; onAdd: (f: Fact) => void }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FactCategoryKey>("basic");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onAdd(await api<Fact>(`/api/people/${personId}/facts`, { method: "POST", json: { category, label, value } }));
      setLabel("");
      setValue("");
      setOpen(false);
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button className="btn ghost small add-fact" onClick={() => setOpen(true)}>
        + 정보 직접 추가
      </button>
    );

  return (
    <form className="add-form" onSubmit={submit}>
      <select value={category} onChange={(e) => setCategory(e.target.value as FactCategoryKey)} aria-label="분류">
        {CATEGORIES.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </select>
      <input placeholder="항목 (예: 사는 곳)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} required />
      <input placeholder="내용 (예: 캐나다 밴쿠버)" value={value} onChange={(e) => setValue(e.target.value)} maxLength={300} required />
      <div className="reply-actions">
        <span className="grow" />
        <button type="button" className="btn ghost small" onClick={() => setOpen(false)}>
          취소
        </button>
        <button className="btn primary small" disabled={busy}>
          추가
        </button>
      </div>
    </form>
  );
}

function Conversation({ items }: { items: PersonDetail["conversation"] }) {
  if (!items.length) return <p className="muted empty">주고받은 댓글이 없어요.</p>;
  const groups: { postId: string; postText: string; items: typeof items }[] = [];
  for (const m of items) {
    const g = groups.find((x) => x.postId === m.postId);
    if (g) g.items.push(m);
    else groups.push({ postId: m.postId, postText: m.postText, items: [m] });
  }
  return (
    <div className="convo">
      {groups.reverse().map((g) => (
        <div key={g.postId} className="convo-group">
          <p className="tiny muted convo-post">원글: {g.postText.slice(0, 50) || "(본문 없음)"}</p>
          {g.items.map((m) => (
            <div key={m.id} className={`bubble ${m.isMine ? "mine" : ""}`}>
              <p>{m.text}</p>
              <span className="tiny muted">{date(m.createdAt)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
