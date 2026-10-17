"use client";

import { useState } from "react";
import { sendJson } from "./api";

export function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <main className="login">
      <form
        className="login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const { role } = await sendJson<{ role: "kid" | "admin" }>("/api/login", { password });
            window.location.href = role === "admin" ? "/admin" : "/chat";
          } catch (err) {
            setError(err instanceof Error ? err.message : "로그인하지 못했어요.");
            setBusy(false);
          }
        }}
      >
        <h1>코딩 친구</h1>
        <p className="muted">로블록스 게임을 Claude와 함께 만들어요</p>
        <input
          type="password"
          inputMode="text"
          autoComplete="current-password"
          autoCapitalize="none"
          placeholder="비밀번호"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        <button className="btn primary big" type="submit" disabled={busy || !password}>
          {busy ? "확인 중…" : "들어가기"}
        </button>
        {error && <p className="err">{error}</p>}
      </form>
    </main>
  );
}
