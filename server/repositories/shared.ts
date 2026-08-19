/**
 * 트렌드/키워드/히트맵/워치리스트 repository가 공유하는 낮은 수준의 DB 조회·타입.
 * 도메인 계산(Ranking/Ticker 등)은 각 repository 또는 service에 둔다.
 */
import { desc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { categories as categoriesTable, collectionRuns, keywords as keywordsTable, trendSnapshots } from "@/db/schema";
import type { KeywordReason } from "@/types/api/keyword";

/** run의 기준 시각 — 수집 창의 최신 버킷이 있으면 그것을, 없으면 프로세스 시작 시각을 쓴다. */
export const RUN_AT = sql<Date>`coalesce(${collectionRuns.bucketAt}, ${collectionRuns.startedAt})`;

/** 타임머신·상세 페이지 스파크라인이 보는 최근 run 개수. */
export const SPARK_WINDOW = 7;

export type RunRow = { id: number; at: Date };

export type SnapshotRow = {
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
export function parseReasons(raw: unknown): KeywordReason[] {
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

/**
 * 최근 run 목록(오래된 → 최신 순) — `trend_snapshots`가 있는 run만.
 *
 * `collection_runs`에는 원문만 긁는 run(현재 pipeline='collect', 매시간)과 랭킹까지
 * 계산해 저장하는 run(pipeline='popular', 2시간마다)이 섞여 있다. pipeline 이름으로
 * 필터링하지 않고 "실제로 trend_snapshots가 있는가"로 걸러서, 파이프라인 구성이
 * 바뀌어도 깨지지 않게 한다.
 */
export async function recentRuns(limit: number): Promise<RunRow[]> {
  const rows = await getDb()
    .select({ id: collectionRuns.id, at: RUN_AT })
    .from(collectionRuns)
    .where(sql`exists (select 1 from ${trendSnapshots} where ${trendSnapshots.runId} = ${collectionRuns.id})`)
    .orderBy(desc(RUN_AT))
    .limit(limit);

  return rows.map((row) => ({ id: row.id, at: new Date(row.at) })).reverse();
}

export async function snapshotsForRuns(runIds: number[]): Promise<SnapshotRow[]> {
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
export function byRank(a: SnapshotRow, b: SnapshotRow): number {
  if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
  if (a.rank !== null) return -1;
  if (b.rank !== null) return 1;
  return (b.score ?? 0) - (a.score ?? 0);
}
