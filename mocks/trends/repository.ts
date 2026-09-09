/**
 * mock 폴백 소스.
 *
 * DB가 없거나 쿼리가 실패했을 때, API 계층이 내려주는 데이터를 mock(`data.ts`,
 * `timeline.ts`)에서 스펙 형태로 조립한다.
 * 12개 스냅샷을 12개 run으로 취급하므로 runId ↔ snapshot.id가 1:1 대응한다.
 */
import { slugify } from "@/lib/utils/slug";
import type { CategoryRow } from "@/types/api/category";
import type { HeatmapPayload } from "@/types/api/heatmap";
import type { HistoryPoint, KeywordDetail } from "@/types/api/keyword";
import type { TickerRow, TimelineSnapshot, TrendRow } from "@/types/api/trend";
import type { WatchlistRow } from "@/types/api/watchlist";

import { realtimeTrends, dailyTrends, watchItems } from "./data";
import {
  getCategoryHeat,
  getTickerItems,
  snapshots as mockSnapshots,
  type RankedItem,
} from "./timeline";

const detailByKeyword = new Map(realtimeTrends.map((trend) => [trend.keyword, trend]));

function toTrendRow(item: RankedItem): TrendRow {
  const detail = detailByKeyword.get(item.keyword);

  return {
    rank: item.rank,
    keyword: item.keyword,
    slug: slugify(item.keyword),
    category: item.category,
    previousRank: item.previousRank,
    growth: item.growth,
    velocity: item.velocity,
    score: item.score,
    risingScore: item.score,
    source: detail?.source ?? "Unknown",
    summary: detail?.summary ?? "",
    reason: detail?.reason ?? "",
    spark: item.spark,
  };
}

export function mockTimeline(): TimelineSnapshot[] {
  const latestId = mockSnapshots[mockSnapshots.length - 1]?.id ?? 0;

  return mockSnapshots.map((snapshot) => ({
    runId: snapshot.id,
    clock: snapshot.clock,
    label: snapshot.label,
    isLatest: snapshot.id === latestId,
    rows: snapshot.items.map(toTrendRow),
    ticker: getTickerItems(snapshot.id) as TickerRow[],
  }));
}

export function mockDailyRows(): TrendRow[] {
  const byKeyword = new Map(
    mockSnapshots[mockSnapshots.length - 1]?.items.map((item) => [item.keyword, item]) ?? [],
  );

  return dailyTrends.map((trend) => {
    const ranked = byKeyword.get(trend.keyword);

    return {
      rank: trend.rank,
      keyword: trend.keyword,
      slug: slugify(trend.keyword),
      category: trend.category,
      previousRank: trend.previousRank ?? null,
      growth: trend.growth,
      velocity: trend.velocity,
      score: ranked?.score ?? 0,
      risingScore: ranked?.score ?? 0,
      source: trend.source,
      summary: trend.summary,
      reason: trend.reason,
      spark: trend.spark ?? ranked?.spark ?? [],
    };
  });
}

export function mockCategories(): CategoryRow[] {
  const names = [...new Set(realtimeTrends.map((trend) => trend.category))];

  return [
    { name: "전체", slug: "all", sortOrder: 0 },
    ...names.map((name, index) => ({ name, slug: slugify(name), sortOrder: index + 1 })),
  ];
}

export function mockHeatmap(): HeatmapPayload {
  const latestId = mockSnapshots[mockSnapshots.length - 1]?.id ?? 0;

  const columns = mockSnapshots.map((snapshot) => ({
    runId: snapshot.id,
    clock: snapshot.clock,
    label: snapshot.label,
    isLatest: snapshot.id === latestId,
  }));

  const heatByColumn = mockSnapshots.map(
    (snapshot) => new Map(getCategoryHeat(snapshot.id).map((row) => [row.category, row.heat])),
  );

  // 행 순서 = 최신 시점 heat 내림차순 (getCategoryHeat가 이미 desc 정렬)
  const categories = getCategoryHeat(latestId).map((row) => row.category);
  const matrix = categories.map((category) =>
    heatByColumn.map((column) => column.get(category) ?? 0),
  );

  return { columns, categories, matrix };
}

export function mockHistory(slug: string): HistoryPoint[] {
  return mockSnapshots.map((snapshot) => {
    const item = snapshot.items.find((entry) => slugify(entry.keyword) === slug);
    return {
      runId: snapshot.id,
      rank: item ? item.rank : null,
      score: item ? item.score : 0,
    };
  });
}

/**
 * 상세 페이지 mock. 기존 `app/trend/page.tsx`에 하드코딩돼 있던 단일 키워드 상세를
 * 모든 키워드에 대해 생성할 수 있게 옮긴 것이다.
 */
export function mockKeywordDetail(slug: string): KeywordDetail | null {
  const latest = mockSnapshots[mockSnapshots.length - 1];
  const item = latest?.items.find((entry) => slugify(entry.keyword) === slug);
  if (!item) return null;

  const detail = detailByKeyword.get(item.keyword);
  const history = mockHistory(slug).slice(-7);

  const channels = (detail?.source ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  return {
    rank: item.rank,
    keyword: item.keyword,
    slug,
    category: item.category,
    growth: item.growth,
    velocity: item.velocity,
    score: item.score,
    detectedAgo: "2시간 전",
    updatedAgo: "방금 전",
    summary: detail?.summary ?? "",
    reasons: channels.map((channel) => ({
      source: channel,
      text: detail?.reason ?? "SNS에서 저장·공유가 빠르게 늘고 있습니다.",
    })),
    series: item.spark,
    days: mockSnapshots.slice(-history.length).map((snapshot) => snapshot.clock),
    related: [],
    keywords: [],
    channels,
    timeline: [],
  };
}

/** 워치리스트 mock — 로그인 이전 상태에서 패널이 비어 보이지 않도록 예비 키워드를 보여준다. */
export function mockWatchlist(): WatchlistRow[] {
  return watchItems.map((item, index) => ({
    id: index + 1,
    keyword: item.keyword,
    slug: slugify(item.keyword),
    category: item.meta.split("·")[0]?.trim() ?? "기타",
    score: Number.parseInt(item.score, 10) || null,
    addedAt: "1970-01-01T00:00:00.000Z",
  }));
}
