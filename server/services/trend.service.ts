import { isDbConfigured } from "@/db";
import { clockLabel, nowIso, relativeTime } from "@/lib/utils/date";
import { normalize } from "@/lib/utils/normalize";
import { mockDailyRows, mockTimeline } from "@/mocks/trends/repository";
import type { TrendPeriod } from "@/server/http/query";
import { dbDailyIngredients, dbTimelineIngredients, type TrendIngredients } from "@/server/repositories/trend.repository";
import { byRank, parseReasons, SPARK_WINDOW, type RunRow, type SnapshotRow } from "@/server/repositories/shared";
import type { ApiResult } from "@/types/api/common";
import type { TickerRow, TimelineSnapshot, TrendRow } from "@/types/api/trend";

/** 타임머신 슬라이더에 올릴 시점 개수. mock 스냅샷 개수와 맞춰 둔다. */
const TIMELINE_RUNS = 12;
const DEFAULT_ROW_LIMIT = 30;

/** 티커에 "급상승"으로 올릴 최소 상승 폭. mock(getTickerItems)과 같은 기준. */
const SURGE_MIN_JUMP = 2;
const TICKER_LIMIT = 8;

function tickerFrom(rows: TrendRow[]): TickerRow[] {
  const items: TickerRow[] = [];

  for (const row of rows) {
    if (row.previousRank === null) {
      items.push({ keyword: row.keyword, kind: "new", delta: 0 });
    } else if (row.previousRank - row.rank >= SURGE_MIN_JUMP) {
      items.push({ keyword: row.keyword, kind: "surge", delta: row.previousRank - row.rank });
    }
  }

  return items
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "new" ? -1 : 1;
      return b.delta - a.delta;
    })
    .slice(0, TICKER_LIMIT);
}

/** run별 원본 스냅샷을 랭킹·등락·스파크·티커까지 계산된 시점별 랭킹으로 조립한다. */
function buildTimeline(runs: RunRow[], rows: SnapshotRow[], rowLimit: number): TimelineSnapshot[] {
  const byRun = new Map<number, SnapshotRow[]>();
  for (const row of rows) {
    const bucket = byRun.get(row.runId);
    if (bucket) bucket.push(row);
    else byRun.set(row.runId, [row]);
  }

  // 키워드별 score 궤적 — spark(최근 7개 run)를 만들기 위해 run 순서대로 쌓아둔다.
  const scoreTrail = new Map<number, number[]>();
  const latestRunId = runs[runs.length - 1].id;
  const now = runs[runs.length - 1].at;

  const previousRanks = new Map<number, number>();
  const snapshots: TimelineSnapshot[] = [];

  for (const run of runs) {
    const runRows = (byRun.get(run.id) ?? []).slice().sort(byRank);

    for (const row of runRows) {
      const trail = scoreTrail.get(row.keywordId) ?? [];
      trail.push(row.score ?? 0);
      scoreTrail.set(row.keywordId, trail);
    }

    const trendRows: TrendRow[] = runRows.slice(0, rowLimit).map((row, index) => {
      const reasons = parseReasons(row.reasons);

      return {
        rank: row.rank ?? index + 1,
        keyword: row.term,
        slug: row.slug,
        category: row.category ?? "기타",
        previousRank: previousRanks.get(row.keywordId) ?? null,
        growth: row.growthRate ?? "-",
        velocity: row.velocity ?? "-",
        score: row.score ?? 0,
        source: row.sourceLabel ?? "Unknown",
        summary: row.summary ?? "",
        reason: reasons[0]?.text ?? "",
        spark: normalize((scoreTrail.get(row.keywordId) ?? []).slice(-SPARK_WINDOW)),
      };
    });

    snapshots.push({
      runId: run.id,
      clock: clockLabel(run.at),
      label: relativeTime(run.at, now),
      isLatest: run.id === latestRunId,
      rows: trendRows,
      ticker: tickerFrom(trendRows),
    });

    // 다음 run의 previousRank 기준을 이번 run으로 갱신 (rowLimit 밖 키워드도 포함)
    previousRanks.clear();
    runRows.forEach((row, index) => previousRanks.set(row.keywordId, row.rank ?? index + 1));
  }

  return snapshots;
}

/** 24시간 창의 run별 원본 스냅샷을 키워드별 평균 score로 재순위한 일간 집계로 조립한다. */
function buildDailyRows(runs: RunRow[], rows: SnapshotRow[], rowLimit: number): TrendRow[] {
  const latestRunId = runs[0].id;
  const aggregated = new Map<
    number,
    { total: number; count: number; latest: SnapshotRow; trail: number[] }
  >();

  // runs는 최신 → 과거 순이므로, trail은 뒤집어서 시간순으로 쌓는다.
  for (const run of [...runs].reverse()) {
    for (const row of rows.filter((entry) => entry.runId === run.id)) {
      const current = aggregated.get(row.keywordId);
      if (current) {
        current.total += row.score ?? 0;
        current.count += 1;
        current.trail.push(row.score ?? 0);
        if (row.runId === latestRunId) current.latest = row;
      } else {
        aggregated.set(row.keywordId, {
          total: row.score ?? 0,
          count: 1,
          latest: row,
          trail: [row.score ?? 0],
        });
      }
    }
  }

  const ranked = [...aggregated.entries()]
    .map(([keywordId, entry]) => ({
      keywordId,
      average: entry.total / entry.count,
      latest: entry.latest,
      trail: entry.trail,
    }))
    .sort((a, b) => b.average - a.average || a.latest.term.localeCompare(b.latest.term));

  // 직전 24시간 대비 순위를 낼 근거가 없으므로, previousRank는 최신 run의 rank를 쓴다.
  return ranked.slice(0, rowLimit).map((entry, index) => {
    const row = entry.latest;
    const reasons = parseReasons(row.reasons);

    return {
      rank: index + 1,
      keyword: row.term,
      slug: row.slug,
      category: row.category ?? "기타",
      previousRank: row.rank,
      growth: row.growthRate ?? "-",
      velocity: row.velocity ?? "-",
      score: Math.round(entry.average),
      source: row.sourceLabel ?? "Unknown",
      summary: row.summary ?? "",
      reason: reasons[0]?.text ?? "",
      spark: normalize(entry.trail.slice(-SPARK_WINDOW)),
    };
  });
}

function hasData(ingredients: TrendIngredients): boolean {
  return ingredients.runs.length > 0 && ingredients.rows.length > 0;
}

/** 홈 랭킹·타임머신이 쓰는 시점별 랭킹 전체. */
export async function getTimeline(
  rowLimit = DEFAULT_ROW_LIMIT,
): Promise<ApiResult<TimelineSnapshot[]>> {
  let data: TimelineSnapshot[] | null = null;
  let source: "db" | "mock" = isDbConfigured() ? "db" : "mock";

  if (isDbConfigured()) {
    const ingredients = await dbTimelineIngredients(TIMELINE_RUNS);
    // run/스냅샷이 없는 건 방금 띄운 DB처럼 정상적으로 비어 있을 수 있는 상태다 —
    // 쿼리 실패가 아니므로 예외를 던지지 않고 여기서 명시적으로 mock으로 넘어간다.
    if (hasData(ingredients)) {
      data = buildTimeline(ingredients.runs, ingredients.rows, rowLimit);
    }
  }

  if (!data) {
    data = mockTimeline();
    source = "mock";
  }

  return { data, meta: { source, updatedAt: nowIso(), runs: data.length } };
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

function filterByCategory(rows: TrendRow[], category?: string): TrendRow[] {
  if (!category || category === "전체" || category === "all") return rows;
  return rows.filter((row) => row.category === category);
}

/** 3.2 GET /api/trends */
export async function getTrends(query: TrendQuery = {}): Promise<ApiResult<TrendRow[]>> {
  const period = query.period ?? "realtime";
  const limit = query.limit ?? DEFAULT_ROW_LIMIT;

  if (period === "daily") {
    let value: TrendRow[] | null = null;
    let source: "db" | "mock" = isDbConfigured() ? "db" : "mock";

    if (isDbConfigured()) {
      const ingredients = await dbDailyIngredients();
      if (hasData(ingredients)) {
        value = buildDailyRows(ingredients.runs, ingredients.rows, limit);
      }
    }

    if (!value) {
      value = mockDailyRows();
      source = "mock";
    }

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
