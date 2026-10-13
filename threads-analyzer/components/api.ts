/** JSON API 호출. 실패하면 서버가 준 메시지로 Error를 던지고, 연결이 끊겼으면 첫 화면으로 보냅니다. */
export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    window.location.href = "/?error=" + encodeURIComponent(body.error ?? "다시 연결해 주세요.");
    throw new Error(body.error ?? "다시 연결해 주세요.");
  }
  if (!res.ok) throw new Error(body.error ?? `요청에 실패했어요 (${res.status})`);
  return body as T;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "알 수 없는 오류가 발생했어요.";
}
