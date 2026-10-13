import Dashboard from "@/components/Dashboard";
import { currentAccount, type Account } from "@/lib/session";

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  let { error } = await searchParams;
  let account: Account | null = null;
  try {
    account = await currentAccount();
  } catch (e) {
    error = `서버 설정을 확인해 주세요: ${e instanceof Error ? e.message : String(e)}`;
  }

  if (account) {
    return <Dashboard profile={{ id: account.id, username: account.username, name: account.name ?? account.username, picture: account.picture }} />;
  }

  return (
    <main className="connect">
      <div className="connect-card">
        <div className="logo" aria-hidden>
          @
        </div>
        <h1>스레드 분석</h1>
        <p className="muted">내 글의 반응을 분석하고, 댓글로 만난 사람들을 대신 기억해 드려요.</p>
        {error && <p className="error">{error}</p>}
        <a className="btn primary" href="/api/auth/login">
          Threads로 연결하기
        </a>
        <p className="tiny muted">Meta 공식 API만 사용해요. 답글은 내가 올리기를 눌렀을 때만 게시돼요.</p>
      </div>
    </main>
  );
}
