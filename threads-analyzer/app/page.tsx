import Dashboard from "@/components/Dashboard";
import { getSession } from "@/lib/session";

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getSession();
  const { error } = await searchParams;

  if (session) return <Dashboard />;

  return (
    <main className="connect">
      <div className="connect-card">
        <div className="logo" aria-hidden>
          @
        </div>
        <h1>스레드 분석</h1>
        <p className="muted">
          내 Threads 계정을 연결하면 게시글별 반응을 모아서 어떤 글이 왜 잘 됐는지 알려 드려요.
        </p>
        {error && <p className="error">{error}</p>}
        <a className="btn primary" href="/api/auth/login">
          Threads로 연결하기
        </a>
        <p className="tiny muted">Meta 공식 API만 사용하며, 글을 대신 올리거나 수정하지 않아요.</p>
      </div>
    </main>
  );
}
