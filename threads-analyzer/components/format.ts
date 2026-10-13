const compact = new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("ko-KR");

export function num(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  return n >= 10000 ? compact.format(n) : full.format(Math.round(n));
}

export function pct(r: number | null | undefined, digits = 1): string {
  return r === null || r === undefined ? "-" : `${(r * 100).toFixed(digits)}%`;
}

export function date(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
