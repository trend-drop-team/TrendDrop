/**
 * 화면·라우트가 함께 쓰는 서비스 계층.
 *
 * 서버 컴포넌트는 이 모듈을 직접 부르고(자기 자신에게 HTTP 요청하지 않도록),
 * `app/api/*` 라우트는 같은 함수를 감싸 외부에 JSON으로 노출한다.
 * 두 경로가 같은 함수를 쓰므로 화면과 API가 갈라질 일이 없다.
 */
import { fromDbOrMock, NotFoundError, type ApiResult } from "@/lib/api/common";
import {
  dbAddWatchlistItem,
  dbCategories,
  dbDailyRows,
  dbHeatmap,
  dbHistory,
  dbKeywordDetail,
  dbRemoveWatchlistItem,
  dbTimeline,
  dbWatchlist,
} from "@/lib/api/db-source";
import {
  mockCategories,
  mockDailyRows,
  mockHeatmap,
  mockHistory,
  mockKeywordDetail,
  mockTimeline,
  mockWatchlist,
} from "@/lib/api/mock-source";
import type {
  CategoryRow,
  HeatmapPayload,
  HistoryPoint,
  KeywordDetail,
  TickerRow,
  TimelineSnapshot,
  TrendRow,
  WatchlistRow,
} from "@/lib/api/types";

/** 타임머신 슬라이더에 올릴 시점 개수. mock 스냅샷 개수와 맞춰 둔다. */
const TIMELINE_RUNS = 12;
const DEFAULT_ROW_LIMIT = 30;

export type TrendPeriod = "realtime" | "daily";

export function parsePeriod(raw: string | null): TrendPeriod {
  return raw === "daily" ? "daily" : "realtime";
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function getCategories(): Promise<ApiResult<CategoryRow[]>> {
  const { value, source } = await fromDbOrMock(dbCategories, mockCategories);
  return { data: value, meta: { source, updatedAt: nowIso() } };
}

/** 홈 랭킹·타임머신이 쓰는 시점별 랭킹 전체. */
export async function getTimeline(
  rowLimit = DEFAULT_ROW_LIMIT,
): Promise<ApiResult<TimelineSnapshot[]>> {
  const { value, source } = await fromDbOrMock(
    () => dbTimeline(TIMELINE_RUNS, rowLimit),
    mockTimeline,
  );

  return { data: value, meta: { source, updatedAt: nowIso(), runs: value.length } };
}

export type TrendQuery = {
  period?: TrendPeriod;
  category?: string;
  limit?: number;
  /** 과거 시점 조회. 없으면 최신 run. */
  runId?: number | null;
};

export type TrendsMeta = {
  period: TrendPeriod;
  runId: number | null;
  ticker: TickerRow[];
};

/** 3.2 GET /api/trends */
export async function getTrends(query: TrendQuery = {}): Promise<ApiResult<TrendRow[]>> {
  const period = query.period ?? "realtime";
  const limit = query.limit ?? DEFAULT_ROW_LIMIT;

  if (period === "daily") {
    const { value, source } = await fromDbOrMock(
      () => dbDailyRows(limit),
      () => mockDailyRows(),
    );

    const rows = filterByCategory(value, query.category).slice(0, limit);
    return {
      data: rows,
      meta: { source, updatedAt: nowIso(), period, runId: null, ticker: [] },
    };
  }

  const timeline = await getTimeline(limit);
  const snapshot =
    (query.runId != null
      ? timeline.data.find((entry) => entry.runId === query.runId)
      : timeline.data.at(-1)) ?? timeline.data.at(-1);

  if (!snapshot) {
    return {
      data: [],
      meta: { source: timeline.meta.source, updatedAt: nowIso(), period, runId: null, ticker: [] },
    };
  }

  const rows = filterByCategory(snapshot.rows, query.category).slice(0, limit);

  return {
    data: rows,
    meta: {
      source: timeline.meta.source,
      updatedAt: nowIso(),
      period,
      runId: snapshot.runId,
      ticker: snapshot.ticker,
    },
  };
}

function filterByCategory(rows: TrendRow[], category?: string): TrendRow[] {
  if (!category || category === "전체" || category === "all") return rows;
  return rows.filter((row) => row.category === category);
}

/** 3.3 GET /api/keywords/:slug — 없는 slug면 NotFoundError. */
export async function getKeywordDetail(slug: string): Promise<ApiResult<KeywordDetail>> {
  const { value, source } = await fromDbOrMock(
    () => dbKeywordDetail(slug),
    () => {
      const detail = mockKeywordDetail(slug);
      if (!detail) throw new NotFoundError(`keyword not found: ${slug}`);
      return detail;
    },
  );

  return { data: value, meta: { source, updatedAt: nowIso() } };
}

/** 3.4 GET /api/keywords/:slug/history */
export async function getKeywordHistory(
  slug: string,
  windowHours: number,
): Promise<ApiResult<HistoryPoint[]>> {
  const { value, source } = await fromDbOrMock(
    () => dbHistory(slug, windowHours),
    () => {
      const points = mockHistory(slug);
      if (points.every((point) => point.rank === null)) {
        throw new NotFoundError(`keyword not found: ${slug}`);
      }
      return points;
    },
  );

  return { data: value, meta: { source, updatedAt: nowIso(), windowHours } };
}

/** 3.5 GET /api/explore/heatmap */
export async function getHeatmap(windowHours: number): Promise<ApiResult<HeatmapPayload>> {
  const { value, source } = await fromDbOrMock(() => dbHeatmap(windowHours), mockHeatmap);
  return { data: value, meta: { source, updatedAt: nowIso(), windowHours } };
}

/** 3.6 워치리스트 — 모두 로그인한 user_id가 필요하다. */
export async function getWatchlist(userId: number): Promise<ApiResult<WatchlistRow[]>> {
  const { value, source } = await fromDbOrMock(() => dbWatchlist(userId), mockWatchlist);
  return { data: value, meta: { source, updatedAt: nowIso() } };
}

export async function addWatchlistItem(userId: number, keywordSlug: string): Promise<number> {
  return dbAddWatchlistItem(userId, keywordSlug);
}

export async function removeWatchlistItem(userId: number, itemId: number): Promise<number> {
  return dbRemoveWatchlistItem(userId, itemId);
}