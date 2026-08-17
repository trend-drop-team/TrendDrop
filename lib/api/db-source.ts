/**
 * 통합 스키마(`db/unified-schema.ts`) 기준 조회 계층.
 *
 * 여기서 던지는 예외는 `fromDbOrMock`이 받아 mock으로 폴백한다 — 통합 스키마가
 * 실제 DB에 아직 반영되기 전이면 컬럼 부재 에러가 나는 게 정상이기 때문이다.
 */
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  categories as categoriesTable,
  collectionRuns,
  keywordRelations,
  keywords as keywordsTable,
  trendContents,
  trendSnapshots,
  watchlistItems,
} from "@/db/unified-schema";
import { clockLabel, NotFoundError, normalize, relativeTime } from "@/lib/api/common";
import type {
  CategoryRow,
  HeatmapPayload,
  HistoryPoint,
  KeywordDetail,
  KeywordReason,
  TickerRow,
  TimelineSnapshot,
  TrendRow,
  WatchlistRow,
} from "@/lib/api/types";

/** run의 기준 시각 — 수집 창의 최신 버킷이 있으면 그것을, 없으면 프로세스 시작 시각을 쓴다. */
const RUN_AT = sql<Date>`coalesce(${collectionRuns.bucketAt}, ${collectionRuns.startedAt})`;

/** 티커에 "급상승"으로 올릴 최소 상승 폭. mock(getTickerItems)과 같은 기준. */
const SURGE_MIN_JUMP = 2;
const TICKER_LIMIT = 8;
const SPARK_WINDOW = 7;

type RunRow = { id: number; at: Date };

type SnapshotRow = {
  runId: number;
  keywordId: number;
  rank: number | null;
  score: number | null;
  growthRate: string | null;
  velocity: string | null;
  summary: string | null;
  reasons: unknown;
  sourceLabel: string | null;
  term: string;
  slug: string;
  category: string | null;
};

/** `trend_snapshots.reasons`(jsonb)를 스펙의 `{ source, text }[]`로 정규화. */
function parseReasons(raw: unknown): KeywordReason[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const source = typeof record.source === "string" ? record.source : null;
    const text = typeof record.text === "string" ? record.text : null;
    if (!source || !text) return [];
    return [{ source, text }];
  });
}

/** 최근 run 목록(오래된 → 최신 순). */
async function recentRuns(limit: number): Promise<RunRow[]> {
  const rows = await getDb()
    .select({ id: collectionRuns.id, at: RUN_AT })
    .from(collectionRuns)
    .orderBy(desc(RUN_AT))
    .limit(limit);

  return rows.map((row) => ({ id: row.id, at: new Date(row.at) })).reverse();
}

async function snapshotsForRuns(runIds: number[]): Promise<SnapshotRow[]> {
  if (runIds.length === 0) return [];

  return getDb()
    .select({
      runId: trendSnapshots.runId,
      keywordId: trendSnapshots.keywordId,
      rank: trendSnapshots.rank,
      score: trendSnapshots.score,
      growthRate: trendSnapshots.growthRate,
      velocity: trendSnapshots.velocity,
      summary: trendSnapshots.summary,
      reasons: trendSnapshots.reasons,
      sourceLabel: trendSnapshots.sourceLabel,
      term: keywordsTable.term,
      slug: keywordsTable.slug,
      category: categoriesTable.name,
    })
    .from(trendSnapshots)
    .innerJoin(keywordsTable, eq(trendSnapshots.keywordId, keywordsTable.id))
    .leftJoin(categoriesTable, eq(keywordsTable.categoryId, categoriesTable.id))
    .where(inArray(trendSnapshots.runId, runIds));
}

/** rank 오름차순. rank가 비어 있는 행은 score 내림차순으로 뒤에 붙인다. */
function byRank(a: SnapshotRow, b: SnapshotRow): number {
  if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
  if (a.rank !== null) return -1;
  if (b.rank !== null) return 1;
  return (b.score ?? 0) - (a.score ?? 0);
}

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

/**
 * 최근 `runCount`개 run을 시점별 랭킹으로 조립한다.
 * 타임머신 슬라이더·히트맵·홈 랭킹이 모두 이 한 번의 조회를 공유한다.
 */
export async function dbTimeline(runCount: number, rowLimit: number): Promise<TimelineSnapshot[]> {
  const runs = await recentRuns(runCount);
  if (runs.length === 0) throw new Error("collection_runs가 비어 있습니다");

  const rows = await snapshotsForRuns(runs.map((run) => run.id));
  if (rows.length === 0) throw new Error("trend_snapshots가 비어 있습니다");

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

/**
 * 24시간 누적 집계. 통합 스키마에 "일간" run 종류가 따로 없으므로
 * 최근 24시간 run들의 키워드별 평균 score로 재순위를 매긴다.
 */
export async function dbDailyRows(rowLimit: number): Promise<TrendRow[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const runs = await getDb()
    .select({ id: collectionRuns.id, at: RUN_AT })
    .from(collectionRuns)
    .where(gte(RUN_AT, since))
    .orderBy(desc(RUN_AT));

  if (runs.length === 0) throw new Error("최근 24시간 run이 없습니다");

  const rows = await snapshotsForRuns(runs.map((run) => run.id));
  if (rows.length === 0) throw new Error("최근 24시간 trend_snapshots가 없습니다");

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

export async function dbCategories(): Promise<CategoryRow[]> {
  const rows = await getDb()
    .select({
      name: categoriesTable.name,
      slug: categoriesTable.slug,
      sortOrder: categoriesTable.sortOrder,
    })
    .from(categoriesTable)
    .orderBy(asc(categoriesTable.sortOrder));

  if (rows.length === 0) throw new Error("categories가 비어 있습니다");

  // "전체" 탭은 DB에 없을 수 있으므로 없으면 맨 앞에 합성해 붙인다.
  return rows.some((row) => row.slug === "all")
    ? rows
    : [{ name: "전체", slug: "all", sortOrder: 0 }, ...rows];
}

export async function dbHeatmap(windowHours: number): Promise<HeatmapPayload> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const runs = await getDb()
    .select({ id: collectionRuns.id, at: RUN_AT })
    .from(collectionRuns)
    .where(gte(RUN_AT, since))
    .orderBy(asc(RUN_AT));

  if (runs.length === 0) throw new Error("히트맵 구간에 run이 없습니다");

  const rows = await snapshotsForRuns(runs.map((run) => run.id));
  if (rows.length === 0) throw new Error("히트맵 구간에 trend_snapshots가 없습니다");

  const order = await getDb()
    .select({ name: categoriesTable.name, sortOrder: categoriesTable.sortOrder })
    .from(categoriesTable)
    .orderBy(asc(categoriesTable.sortOrder));

  const sortIndex = new Map(order.map((row) => [row.name, row.sortOrder]));
  const categoryNames = [...new Set(rows.map((row) => row.category ?? "기타"))].sort(
    (a, b) => (sortIndex.get(a) ?? Number.MAX_SAFE_INTEGER) - (sortIndex.get(b) ?? Number.MAX_SAFE_INTEGER),
  );

  const latestRunId = runs[runs.length - 1].id;
  const now = runs[runs.length - 1].at;

  const columns = runs.map((run) => ({
    runId: run.id,
    clock: clockLabel(run.at),
    label: relativeTime(run.at, now),
    isLatest: run.id === latestRunId,
  }));

  // 시점별로 "상위권일수록 큰 가중치"를 합산한 뒤 그 시점 최댓값 기준 0~100으로 정규화한다.
  // (mock의 getCategoryHeat와 같은 규칙 — 열끼리 비교하는 게 아니라 열 안에서의 분포를 본다.)
  const matrix = categoryNames.map(() => new Array<number>(runs.length).fill(0));

  runs.forEach((run, columnIndex) => {
    const runRows = rows.filter((row) => row.runId === run.id).sort(byRank);
    const total = runRows.length;
    if (total === 0) return;

    const weights = new Map<string, number>();
    runRows.forEach((row, index) => {
      const category = row.category ?? "기타";
      const rank = row.rank ?? index + 1;
      weights.set(category, (weights.get(category) ?? 0) + (total - rank + 1));
    });

    const maxWeight = Math.max(...weights.values(), 0);
    if (maxWeight <= 0) return;

    categoryNames.forEach((category, rowIndex) => {
      matrix[rowIndex][columnIndex] = Math.round(((weights.get(category) ?? 0) / maxWeight) * 100);
    });
  });

  return { columns, categories: categoryNames, matrix };
}

export async function dbHistory(slug: string, windowHours: number): Promise<HistoryPoint[]> {
  const db = getDb();
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const [keyword] = await db
    .select({ id: keywordsTable.id })
    .from(keywordsTable)
    .where(eq(keywordsTable.slug, slug))
    .limit(1);

  if (!keyword) throw new NotFoundError(`keyword not found: ${slug}`);

  const runs = await db
    .select({ id: collectionRuns.id })
    .from(collectionRuns)
    .where(gte(RUN_AT, since))
    .orderBy(asc(RUN_AT));

  if (runs.length === 0) throw new Error("history 구간에 run이 없습니다");

  const rows = await db
    .select({
      runId: trendSnapshots.runId,
      rank: trendSnapshots.rank,
      score: trendSnapshots.score,
    })
    .from(trendSnapshots)
    .where(
      and(
        eq(trendSnapshots.keywordId, keyword.id),
        inArray(
          trendSnapshots.runId,
          runs.map((run) => run.id),
        ),
      ),
    );

  const byRun = new Map(rows.map((row) => [row.runId, row]));

  // 해당 시점에 순위권 밖이면 rank: null — 이탈 구간을 차트에서 끊어 그리기 위함.
  return runs.map((run) => {
    const row = byRun.get(run.id);
    return { runId: run.id, rank: row?.rank ?? null, score: row?.score ?? 0 };
  });
}

export async function dbKeywordDetail(slug: string): Promise<KeywordDetail> {
  const db = getDb();

  const [keyword] = await db
    .select({
      id: keywordsTable.id,
      term: keywordsTable.term,
      slug: keywordsTable.slug,
      firstSeenAt: keywordsTable.firstSeenAt,
      category: categoriesTable.name,
    })
    .from(keywordsTable)
    .leftJoin(categoriesTable, eq(keywordsTable.categoryId, categoriesTable.id))
    .where(eq(keywordsTable.slug, slug))
    .limit(1);

  if (!keyword) throw new NotFoundError(`keyword not found: ${slug}`);

  const history = await db
    .select({
      runId: trendSnapshots.runId,
      rank: trendSnapshots.rank,
      score: trendSnapshots.score,
      growthRate: trendSnapshots.growthRate,
      velocity: trendSnapshots.velocity,
      summary: trendSnapshots.summary,
      reasons: trendSnapshots.reasons,
      sourceLabel: trendSnapshots.sourceLabel,
      capturedAt: trendSnapshots.capturedAt,
      runAt: RUN_AT,
    })
    .from(trendSnapshots)
    .innerJoin(collectionRuns, eq(trendSnapshots.runId, collectionRuns.id))
    .where(eq(trendSnapshots.keywordId, keyword.id))
    .orderBy(desc(RUN_AT))
    .limit(SPARK_WINDOW);

  const latest = history[0];
  if (!latest) throw new NotFoundError(`snapshot not found: ${slug}`);

  // history는 최신 → 과거 순이므로 차트용으로 뒤집는다.
  const chronological = [...history].reverse();
  const now = new Date(latest.runAt);

  const contents = await db
    .select({
      kind: trendContents.kind,
      title: trendContents.title,
      url: trendContents.url,
      thumbnailUrl: trendContents.thumbnailUrl,
      metricLabel: trendContents.metricLabel,
      source: trendContents.source,
    })
    .from(trendContents)
    .where(eq(trendContents.keywordId, keyword.id))
    .orderBy(asc(trendContents.rank))
    .limit(12);

  const related = await db
    .select({ term: keywordsTable.term })
    .from(keywordRelations)
    .innerJoin(keywordsTable, eq(keywordRelations.relatedKeywordId, keywordsTable.id))
    .where(eq(keywordRelations.keywordId, keyword.id))
    .orderBy(desc(keywordRelations.weight))
    .limit(12);

  const reasons = parseReasons(latest.reasons);
  const channels = [
    ...new Set([
      ...reasons.map((reason) => reason.source),
      ...(latest.sourceLabel ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
    ]),
  ];

  return {
    rank: latest.rank ?? 0,
    keyword: keyword.term,
    slug: keyword.slug,
    category: keyword.category ?? "기타",
    growth: latest.growthRate ?? "-",
    velocity: latest.velocity ?? "-",
    score: latest.score ?? 0,
    detectedAgo: relativeTime(keyword.firstSeenAt, now),
    updatedAgo: relativeTime(latest.capturedAt, now),
    summary: latest.summary ?? "",
    reasons,
    series: normalize(chronological.map((row) => row.score ?? 0)),
    days: chronological.map((row) => clockLabel(new Date(row.runAt))),
    related: contents.map((content) => ({
      platform: content.source ?? content.kind,
      title: content.title,
      metric: content.metricLabel ?? "",
      kind: content.kind,
      url: content.url,
      thumbnailUrl: content.thumbnailUrl,
      // 4.1절 excerpt 컬럼이 스키마에 추가되기 전까지는 채울 데이터가 없다.
      excerpt: null,
    })),
    keywords: related.map((row) => row.term),
    channels,
    // 4.2절 trend_events 테이블이 추가되기 전까지는 빈 배열 — 화면이 합성 데이터로 대체한다.
    timeline: [],
  };
}

export async function dbWatchlist(userId: number): Promise<WatchlistRow[]> {
  const db = getDb();

  const items = await db
    .select({
      id: watchlistItems.id,
      keywordId: watchlistItems.keywordId,
      addedAt: watchlistItems.addedAt,
      term: keywordsTable.term,
      slug: keywordsTable.slug,
      category: categoriesTable.name,
    })
    .from(watchlistItems)
    .innerJoin(keywordsTable, eq(watchlistItems.keywordId, keywordsTable.id))
    .leftJoin(categoriesTable, eq(keywordsTable.categoryId, categoriesTable.id))
    .where(eq(watchlistItems.userId, userId))
    .orderBy(desc(watchlistItems.addedAt));

  if (items.length === 0) return [];

  const [latestRun] = await db
    .select({ id: collectionRuns.id })
    .from(collectionRuns)
    .orderBy(desc(RUN_AT))
    .limit(1);

  const scores = latestRun
    ? await db
        .select({ keywordId: trendSnapshots.keywordId, score: trendSnapshots.score })
        .from(trendSnapshots)
        .where(
          and(
            eq(trendSnapshots.runId, latestRun.id),
            inArray(
              trendSnapshots.keywordId,
              items.map((item) => item.keywordId),
            ),
          ),
        )
    : [];

  const scoreByKeyword = new Map(scores.map((row) => [row.keywordId, row.score]));

  return items.map((item) => ({
    id: item.id,
    keyword: item.term,
    slug: item.slug,
    category: item.category ?? "기타",
    score: scoreByKeyword.get(item.keywordId) ?? null,
    addedAt: item.addedAt.toISOString(),
  }));
}

export async function dbAddWatchlistItem(userId: number, keywordSlug: string): Promise<number> {
  const db = getDb();

  const [keyword] = await db
    .select({ id: keywordsTable.id })
    .from(keywordsTable)
    .where(eq(keywordsTable.slug, keywordSlug))
    .limit(1);

  if (!keyword) throw new NotFoundError(`keyword not found: ${keywordSlug}`);

  // 랭킹 행 ★와 워치리스트 패널이 같은 테이블을 쓰므로 중복 추가는 조용히 무시한다.
  const [inserted] = await db
    .insert(watchlistItems)
    .values({ userId, keywordId: keyword.id })
    .onConflictDoNothing({ target: [watchlistItems.userId, watchlistItems.keywordId] })
    .returning({ id: watchlistItems.id });

  if (inserted) return inserted.id;

  const [existing] = await db
    .select({ id: watchlistItems.id })
    .from(watchlistItems)
    .where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.keywordId, keyword.id)))
    .limit(1);

  return existing.id;
}

/** 삭제된 행 수. 0이면 남의 항목이거나 이미 지워진 항목. */
export async function dbRemoveWatchlistItem(userId: number, itemId: number): Promise<number> {
  const deleted = await getDb()
    .delete(watchlistItems)
    .where(and(eq(watchlistItems.id, itemId), eq(watchlistItems.userId, userId)))
    .returning({ id: watchlistItems.id });

  return deleted.length;
}