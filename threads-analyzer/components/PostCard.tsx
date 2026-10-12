import { engagementRate, mediaLabel } from "@/lib/analysis";
import type { Post } from "@/lib/types";
import { date, num, pct } from "./format";

export default function PostCard({ post, rank }: { post: Post; rank?: number }) {
  const m = post.metrics;
  return (
    <article className="post">
      <header className="post-head">
        {rank !== undefined && <span className="rank">{rank}</span>}
        <span className="muted tiny">
          {date(post.timestamp)} · {mediaLabel(post.mediaType)}
          {post.isQuote && " · 인용"}
        </span>
        <span className="rate">{pct(engagementRate(post))}</span>
      </header>
      <p className="post-text">{post.text || <span className="muted">(본문 없음)</span>}</p>
      <dl className="post-metrics">
        <div>
          <dt>조회</dt>
          <dd>{num(m.views)}</dd>
        </div>
        <div>
          <dt>좋아요</dt>
          <dd>{num(m.likes)}</dd>
        </div>
        <div>
          <dt>답글</dt>
          <dd>{num(m.replies)}</dd>
        </div>
        <div>
          <dt>리포스트</dt>
          <dd>{num(m.reposts)}</dd>
        </div>
        <div>
          <dt>인용</dt>
          <dd>{num(m.quotes)}</dd>
        </div>
        <div>
          <dt>공유</dt>
          <dd>{num(m.shares)}</dd>
        </div>
      </dl>
      {post.permalink && (
        <a className="tiny link" href={post.permalink} target="_blank" rel="noreferrer">
          Threads에서 보기 →
        </a>
      )}
    </article>
  );
}
