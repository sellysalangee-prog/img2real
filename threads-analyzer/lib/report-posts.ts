import { env } from "./env";
import type { Post } from "./types";

export const PERIODS = [30, 90, 0] as const;

/** days가 0이면 전체 기간 */
export function withinDays(posts: Post[], days: number): Post[] {
  if (!days) return posts;
  const from = Date.now() - days * 86400_000;
  return posts.filter((p) => new Date(p.timestamp).getTime() >= from);
}

/** 리포트에 쓰는 최대 글 수 (분석 탭과 같은 설정을 씁니다) */
export const reportMaxPosts = () => Math.max(env.maxPosts(), 50);
