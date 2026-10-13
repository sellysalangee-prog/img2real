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

// ---------- 인물 기억 ----------

export type FactCategoryKey = "basic" | "life" | "interest" | "recent" | "other";

export type Fact = {
  id: string;
  category: FactCategoryKey;
  label: string;
  value: string;
  /** 근거가 된 댓글 내용 */
  sourceText: string | null;
  statedAt: string | null;
  status: "current" | "past";
  origin: "ai" | "user";
};

export type InfluenceTypeKey = "spark" | "connector" | "talker" | "regular" | "newcomer";

export type PersonCard = {
  id: string;
  username: string;
  notes: string;
  labels: string[];
  influence: InfluenceTypeKey;
  forgotten: boolean;
  commentCount: number;
  /** 아직 정보 정리를 안 한 댓글이 있으면 true */
  pending: boolean;
  facts: Fact[];
};

export type InboxItem = {
  id: string;
  text: string;
  createdAt: string;
  permalink: string | null;
  status: "open" | "replied" | "dismissed";
  post: { text: string; permalink: string | null };
  /** 이 댓글이 내 답글에 단 것이면 그 내 답글 내용 */
  myParentText: string | null;
  person: PersonCard | null;
};

export type PersonSummary = {
  id: string;
  username: string;
  notes: string;
  labels: string[];
  influence: InfluenceTypeKey;
  lastSeenAt: string;
  commentCount: number;
  openCount: number;
  /** 아직 정보 정리를 안 한 댓글이 있으면 true */
  pending: boolean;
  facts: Fact[];
};

export type ConversationItem = {
  id: string;
  text: string;
  createdAt: string;
  isMine: boolean;
  postId: string;
  postText: string;
  permalink: string | null;
};

export type PersonDetail = {
  id: string;
  username: string;
  notes: string;
  labels: string[];
  influence: {
    type: InfluenceTypeKey;
    comments: number;
    started: number;
    pulledIn: number;
    joinedOthers: number;
    withMe: number;
  };
  firstSeenAt: string;
  lastSeenAt: string;
  facts: Fact[];
  conversation: ConversationItem[];
};

export type CheckResult = {
  verdict: "ok" | "caution";
  issues: { quote: string; problem: string; suggestion: string }[];
  revised: string;
};
