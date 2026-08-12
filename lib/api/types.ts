/**
 * `docs/unified-schema-api-spec.md` 응답 형태를 타입으로 옮긴 것.
 * 라우트 핸들러와 서버 컴포넌트가 같은 타입을 공유한다.
 */

/** 3.1 GET /api/categories */
export type CategoryRow = {
  name: string;
  slug: string;
  sortOrder: number;
};

/** 3.2 GET /api/trends — data[] */
export type TrendRow = {
  rank: number;
  keyword: string;
  slug: string;
  category: string;
  /** 직전 run 대비 순위. null이면 신규 진입(NEW). */
  previousRank: number | null;
  growth: string;
  velocity: string;
  score: number;
  source: string;
  summary: string;
  /** 호버 프리뷰 "왜 뜨나" 한 줄. reasons 첫 항목에서 뽑는다. */
  reason: string;
  /** 최근 7개 run의 score 시계열(0~100 정규화). */
  spark: number[];
};

/** 3.2 meta.ticker */
export type TickerRow = {
  keyword: string;
  kind: "new" | "surge";
  delta: number;
};

/** 한 번의 수집 실행(=시계열의 한 시점). 타임머신 슬라이더의 눈금 하나. */
export type RunColumn = {
  runId: number;
  /** "14:00" */
  clock: string;
  /** "3시간 전" / "지금" */
  label: string;
  isLatest: boolean;
};

/** 타임머신·히트맵이 함께 쓰는 시점별 랭킹 묶음. */
export type TimelineSnapshot = RunColumn & {
  rows: TrendRow[];
  ticker: TickerRow[];
};

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

/** 3.5 GET /api/explore/heatmap */
export type HeatmapPayload = {
  columns: RunColumn[];
  categories: string[];
  /** matrix[카테고리행][시점열] = heat(0~100) */
  matrix: number[][];
};

/** 3.6 워치리스트 */
export type WatchlistRow = {
  id: number;
  keyword: string;
  slug: string;
  category: string;
  score: number | null;
  addedAt: string;
};