/** 3.3 GET /api/keywords/:slug */
export type KeywordReason = {
  source: string;
  text: string;
};

export type KeywordRelatedContent = {
  platform: string;
  title: string;
  metric: string;
  kind: string;
  url: string;
  thumbnailUrl: string | null;
  /** 4.1절 제안 컬럼(trend_contents.excerpt). 스키마 반영 전까지 항상 null. */
  excerpt: string | null;
};

export type KeywordTimelineEvent = {
  channel: string;
  detectedAt: string;
  label: string;
};

export type KeywordDetail = {
  rank: number;
  keyword: string;
  slug: string;
  category: string;
  growth: string;
  velocity: string;
  score: number;
  detectedAgo: string;
  updatedAgo: string;
  summary: string;
  reasons: KeywordReason[];
  series: number[];
  days: string[];
  related: KeywordRelatedContent[];
  /** 연관 키워드 칩. */
  keywords: string[];
  channels: string[];
  /** 4.2절 제안 테이블(trend_events). 스키마 반영 전까지 항상 빈 배열. */
  timeline: KeywordTimelineEvent[];
};

/** 3.4 GET /api/keywords/:slug/history */
export type HistoryPoint = {
  runId: number;
  /** 순위권 밖이면 null. */
  rank: number | null;
  score: number;
};
