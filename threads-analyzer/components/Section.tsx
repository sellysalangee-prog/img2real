"use client";

import { useState } from "react";

/** 접었다 펼 수 있는 카드. 접혀 있을 때는 제목과 한 줄 결론만 보여줍니다. */
export default function Section({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="card fold">
      <button className="fold-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="fold-title">{title}</span>
        <span className="fold-icon" aria-hidden>
          {open ? "−" : "+"}
        </span>
      </button>
      {!open && summary && <div className="fold-summary">{summary}</div>}
      {open && <div className="fold-body">{children}</div>}
    </section>
  );
}
