"use client";

import { useState } from "react";
import type { Profile } from "@/lib/types";
import Analytics from "./Analytics";
import Inbox from "./Inbox";
import People from "./People";

const SECTIONS = ["댓글함", "사람", "분석"] as const;
type Section = (typeof SECTIONS)[number];

export default function Dashboard({ profile }: { profile: Profile }) {
  const [section, setSection] = useState<Section>("댓글함");
  // 한 번 연 화면은 탭을 옮겨도 상태를 유지합니다.
  const [opened, setOpened] = useState<Set<Section>>(new Set(["댓글함"]));
  const [personId, setPersonId] = useState<string | null>(null);

  function go(s: Section) {
    setSection(s);
    setOpened((prev) => new Set(prev).add(s));
  }

  function openPerson(id: string) {
    setPersonId(id);
    go("사람");
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="who">
          {profile.picture ? <img src={profile.picture} alt="" className="avatar" /> : <span className="avatar placeholder" />}
          <div>
            <b>{profile.name ?? profile.username}</b>
            <span className="tiny muted">@{profile.username}</span>
          </div>
        </div>
        <form action="/api/auth/logout" method="post">
          <button className="btn ghost small" type="submit">
            연결 해제
          </button>
        </form>
      </header>

      <nav className="tabs" role="tablist">
        {SECTIONS.map((s) => (
          <button key={s} role="tab" aria-selected={section === s} onClick={() => go(s)}>
            {s}
          </button>
        ))}
      </nav>

      {opened.has("댓글함") && (
        <div hidden={section !== "댓글함"}>
          <Inbox onOpenPerson={openPerson} />
        </div>
      )}
      {opened.has("사람") && (
        <div hidden={section !== "사람"}>
          <People selectedId={personId} onSelect={setPersonId} />
        </div>
      )}
      {opened.has("분석") && (
        <div hidden={section !== "분석"}>
          <Analytics />
        </div>
      )}
    </div>
  );
}
