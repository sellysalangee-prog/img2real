function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`환경 변수 ${name}가 설정되지 않았습니다.`);
  return value;
}

export const env = {
  appId: () => required("THREADS_APP_ID"),
  appSecret: () => required("THREADS_APP_SECRET"),
  appUrl: () => required("APP_URL").replace(/\/$/, ""),
  sessionSecret: () => required("SESSION_SECRET"),
  maxPosts: () => Number(process.env.MAX_POSTS) || 150,
};

export const REDIRECT_PATH = "/api/auth/callback";
