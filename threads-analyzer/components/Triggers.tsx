"use client";

import { useEffect, useState } from "react";
import type { TriggerItem, TriggerReport } from "@/lib/influence";
import { api, errorMessage } from "./api";
import { date } from "./format";
import Section from "./Section";

type PersonRef = { id: string; username: string };

/** 사람 아이디를 누르면 사람 탭의 카드로 이동합니다. */
function usePeopleIndex() {
  const [index, setIndex] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    api<{ people: PersonRef[] }>("/api/people?q=")
      .then((r) => setIndex(new Map(r.people.map((p) => [p.username, p.id]))))
      .catch(() => {});
  }, []);
  return index;
}

function Who({ username, index, onOpenPerson }: { username: string; index: Map<string, string>; onOpenPerson: (id: string) => void }) {
  const id = index.get(username);
  return id ? (
    <button className="link-btn" onClick={() => onOpenPerson(id)}>
      @{username}
    </button>
  ) : (
    <b>@{username}</b>
  );
}

export default function Triggers({ days, onOpenPerson }: { days: number; onOpenPerson: (id: string) => void }) {
  const [report, setReport] = useState<TriggerReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const index = usePeopleIndex();

  useEffect(() => {
    setReport(null);
    setError(null);
    api<TriggerReport>(`/api/triggers?days=${days}`)
      .then(setReport)
      .catch((e) => setError(errorMessage(e)));
  }, [days]);

  if (error) return <p className="error">{error}</p>;
  if (!report) return <div className="skeleton" />;

  const top = report.triggers[0];

  return (
    <>
      <section className="card">
        <h3>댓글 트리거</h3>
        <p className="tiny muted">
          내 글에 달린 댓글 중 <b>아래로 대화가 이어지고 다른 사람을 끌어들인 댓글</b>을 찾아요. Threads 인사이트에는 없는 분석이에요.
        </p>
        <div className="report-meta">
          <div>
            <span className="kpi-label">댓글</span>
            <span className="kpi-value">{report.counts.comments}</span>
          </div>
          <div>
            <span className="kpi-label">참여한 사람</span>
            <span className="kpi-value">{report.counts.people}</span>
          </div>
          <div>
            <span className="kpi-label">이어진 대화</span>
            <span className="kpi-value">{report.counts.conversations}</span>
          </div>
        </div>
        {top ? (
          <p className="callout">
            가장 큰 불씨: <Who username={top.username} index={index} onOpenPerson={onOpenPerson} />의 댓글이 답글 <b>{top.replies}개</b>, 새로 들어온 사람{" "}
            <b>{top.people}명</b>으로 이어졌어요.
          </p>
        ) : (
          <p className="muted empty">이 기간에는 대화가 이어진 댓글이 없어요. 댓글함에서 새 댓글을 가져오면 분석돼요.</p>
        )}
      </section>

      {report.triggers.length > 0 && (
        <Section title={`트리거 댓글 TOP ${report.triggers.length}`} defaultOpen>
          <p className="tiny muted">점수 = 이어진 답글 + 끌려온 사람×2 + 대화 깊이</p>
          {report.triggers.map((t, i) => (
            <TriggerCard key={t.id} rank={i + 1} t={t} index={index} onOpenPerson={onOpenPerson} />
          ))}
        </Section>
      )}

      {report.connectors.length > 0 && (
        <Section
          title="연결고리 사람"
          summary={
            <p className="tiny">
              1위 @{report.connectors[0].username} · {report.connectors[0].pulledIn}명을 대화로 끌어들임
            </p>
          }
        >
          <p className="tiny muted">이 사람이 댓글을 달면 다른 사람들이 따라 들어와요.</p>
          <ul className="rank-list">
            {report.connectors.map((c, i) => (
              <li key={c.username}>
                <span className="rank-num">{i + 1}</span>
                <Who username={c.username} index={index} onOpenPerson={onOpenPerson} />
                <span className="tiny muted right">
                  {c.pulledIn}명 끌어들임 · 대화 {c.started}번 시작
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {report.pairs.length > 0 && (
        <Section
          title="내 글에서 만난 사이"
          summary={
            <p className="tiny">
              @{report.pairs[0].a} ↔ @{report.pairs[0].b} · {report.pairs[0].exchanges}번 주고받음
            </p>
          }
        >
          <p className="tiny muted">내 글 댓글에서 서로에게 답한 사람들이에요 (나는 빼고 셌어요).</p>
          <ul className="rank-list">
            {report.pairs.map((p) => (
              <li key={p.a + p.b}>
                <Who username={p.a} index={index} onOpenPerson={onOpenPerson} />
                <span className="muted">↔</span>
                <Who username={p.b} index={index} onOpenPerson={onOpenPerson} />
                <span className="tiny muted right">{p.exchanges}번</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function TriggerCard({
  rank,
  t,
  index,
  onOpenPerson,
}: {
  rank: number;
  t: TriggerItem;
  index: Map<string, string>;
  onOpenPerson: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const speedUp = t.after >= 3 && t.after >= (t.before + 1) * 2;
  return (
    <div className="trigger">
      <div className="trigger-head">
        <span className="rank">{rank}</span>
        <Who username={t.username} index={index} onOpenPerson={onOpenPerson} />
        <span className="tiny muted right">{date(t.createdAt)}</span>
      </div>
      <p className="trigger-text">{t.text || <span className="muted">(내용 없음)</span>}</p>
      <ul className="chips">
        <li className="chip">답글 {t.replies}개</li>
        <li className="chip cat-interest">끌려온 사람 {t.people}명</li>
        <li className="chip">{t.depth}단계까지</li>
        {speedUp && <li className="chip cat-recent">이후 1시간 댓글 {t.after}개 ↑</li>}
        <li className="chip">{t.myReplyMinutes === null ? "내 답 없음" : t.myReplyMinutes < 60 ? `내 답 ${t.myReplyMinutes}분 후` : `내 답 ${Math.round(t.myReplyMinutes / 60)}시간 후`}</li>
      </ul>
      <button className="link-btn tiny" onClick={() => setOpen((v) => !v)}>
        {open ? "접기" : "누가 들어왔는지 보기"}
      </button>
      {open && (
        <div className="trigger-more tiny">
          <p className="muted">원글: {t.postText.slice(0, 60) || "(본문 없음)"}</p>
          {t.participants.length > 0 ? (
            <p>
              따라 들어온 사람:{" "}
              {t.participants.map((u, i) => (
                <span key={u}>
                  {i > 0 && ", "}
                  <Who username={u} index={index} onOpenPerson={onOpenPerson} />
                </span>
              ))}
            </p>
          ) : (
            <p className="muted">다른 사람은 없고, 나와 주고받은 대화예요.</p>
          )}
          {t.permalink && (
            <a className="link" href={t.permalink} target="_blank" rel="noreferrer">
              Threads에서 보기 →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
