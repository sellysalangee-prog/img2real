"use client";

import { useState } from "react";
import type { AiInsight, Post } from "@/lib/types";

export default function AiPanel({ posts, periodLabel }: { posts: Post[]; periodLabel: string }) {
  const [result, setResult] = useState<AiInsight | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posts }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "분석에 실패했어요.");
      setResult(body as AiInsight);
    } catch (e) {
      setError(e instanceof Error ? e.message : "분석에 실패했어요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h3>AI 분석</h3>
        <button className="btn primary small" onClick={run} disabled={loading || posts.length < 3}>
          {loading ? "분석 중…" : result ? "다시 분석" : "분석 시작"}
        </button>
      </div>
      {!result && !loading && !error && (
        <p className="muted">
          {periodLabel} 동안 올린 글 {posts.length}개와 답글을 Claude가 읽고, 잘 된 이유와 다음 글 아이디어를 정리해 줘요. 1분 정도 걸려요.
        </p>
      )}
      {loading && <div className="skeleton" aria-label="분석 중" />}
      {error && <p className="error">{error}</p>}
      {result && !loading && (
        <div className="ai">
          <p className="ai-summary">{result.summary}</p>

          <h4>잘 된 글의 공통점</h4>
          <ul className="list good">
            {result.winningPatterns.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>

          <h4>아쉬웠던 글의 공통점</h4>
          <ul className="list bad">
            {result.losingPatterns.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>

          <h4>주제별 성과</h4>
          <div className="topics">
            {result.topics.map((t) => (
              <div key={t.name} className="topic">
                <div className="topic-head">
                  <b>{t.name}</b>
                  <span className="tiny muted">{t.postCount}개</span>
                </div>
                <p className="tiny">{t.performance}</p>
              </div>
            ))}
          </div>

          <h4>답글 분위기</h4>
          <div className="mood">
            <span style={{ flex: result.replyMood.positive || 0.001 }} className="mood-pos" />
            <span style={{ flex: result.replyMood.question || 0.001 }} className="mood-q" />
            <span style={{ flex: result.replyMood.negative || 0.001 }} className="mood-neg" />
          </div>
          <p className="tiny muted mood-legend">
            긍정 {Math.round(result.replyMood.positive)}% · 질문 {Math.round(result.replyMood.question)}% · 부정 {Math.round(result.replyMood.negative)}%
          </p>
          <p>{result.replyMood.note}</p>

          <h4>다음 글 아이디어</h4>
          <ol className="ideas">
            {result.nextIdeas.map((idea) => (
              <li key={idea.title}>
                <b>{idea.title}</b>
                <p className="muted">{idea.why}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
