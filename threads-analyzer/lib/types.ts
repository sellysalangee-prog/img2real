export type Profile = {
  id: string;
  username: string;
  name: string;
  picture: string | null;
};

export type PostMetrics = {
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  shares: number;
};

export type Post = {
  id: string;
  text: string;
  mediaType: string;
  timestamp: string;
  permalink: string | null;
  isQuote: boolean;
  metrics: PostMetrics;
};

export type DailyPoint = { date: string; views: number };

export type Reply = { postId: string; text: string; username: string };

export type DashboardData = {
  profile: Profile;
  posts: Post[];
  daily: DailyPoint[];
  followers: number | null;
  fetchedAt: string;
};

export type AiInsight = {
  summary: string;
  winningPatterns: string[];
  losingPatterns: string[];
  topics: { name: string; postCount: number; performance: string }[];
  replyMood: { positive: number; negative: number; question: number; note: string };
  nextIdeas: { title: string; why: string }[];
};
