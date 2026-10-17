export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401 && !url.startsWith("/api/login")) {
    window.location.href = "/";
  }
  if (!res.ok) throw new Error(data.error ?? `오류가 생겼어요 (${res.status})`);
  return data as T;
}

export function sendJson<T>(url: string, body: unknown, method = "POST"): Promise<T> {
  return api<T>(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export async function logout() {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/";
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}
