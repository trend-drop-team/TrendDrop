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
  /** 최근 1시간 증가세 점수(0~100). */
  risingScore: number;
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
