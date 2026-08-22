import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  categories as categoriesTable,
  collectionRuns,
  keywordRelations,
  keywords as keywordsTable,
  trendContents,
  trendSnapshots,
} from "@/db/schema";
import { RUN_AT, SPARK_WINDOW } from "@/server/repositories/shared";

export type KeywordRow = {
  id: number;
  term: string;
  slug: string;
  firstSeenAt: Date;
  category: string | null;
};

/** slug로 키워드 조회. 없으면 null(존재 여부 판단은 service가 한다). */
export async function dbFindKeywordBySlug(slug: string): Promise<KeywordRow | null> {
  const [row] = await getDb()
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

  return row ?? null;
}

export type HistoryRunRow = { id: number };
export type HistorySnapshotRow = { runId: number; rank: number | null; score: number | null };

/** `since` 이후 run 목록과 해당 키워드의 스냅샷 원본. 순위권 이탈(null) 채움은 service가 한다. */
export async function dbHistoryIngredients(
  keywordId: number,
  since: Date,
): Promise<{ runs: HistoryRunRow[]; rows: HistorySnapshotRow[] }> {
  const db = getDb();

  // `RUN_AT`은 컬럼이 아니라 raw sql 조각이라 drizzle의 gte()에 Date를 직접 넘기면
  // 파라미터 타입을 못 정해 런타임 에러가 난다 — ISO 문자열로 비교한다.
  const runs = await db
    .select({ id: collectionRuns.id })
    .from(collectionRuns)
    .where(sql`${RUN_AT} >= ${since.toISOString()}`)
    .orderBy(asc(RUN_AT));

  if (runs.length === 0) return { runs: [], rows: [] };

  const rows = await db
    .select({
      runId: trendSnapshots.runId,
      rank: trendSnapshots.rank,
      score: trendSnapshots.score,
    })
    .from(trendSnapshots)
    .where(
      and(
        eq(trendSnapshots.keywordId, keywordId),
        inArray(
          trendSnapshots.runId,
          runs.map((run) => run.id),
        ),
      ),
    );

  return { runs, rows };
}

export type KeywordSnapshotRow = {
  runId: number;
  rank: number | null;
  score: number | null;
  growthRate: string | null;
  velocity: string | null;
  summary: string | null;
  reasons: unknown;
  sourceLabel: string | null;
  capturedAt: Date;
  runAt: Date;
};

/** 최근 `SPARK_WINDOW`개 run의 스냅샷(최신 → 과거). 상세 페이지 히어로·스파크라인 원본. */
export async function dbKeywordSnapshotHistory(keywordId: number): Promise<KeywordSnapshotRow[]> {
  const rows = await getDb()
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
    .where(eq(trendSnapshots.keywordId, keywordId))
    .orderBy(desc(RUN_AT))
    .limit(SPARK_WINDOW);

  // `RUN_AT`으로 select한 값은 자동으로 Date 인스턴스가 되지 않는다 — 여기서 감싼다.
  return rows.map((row) => ({ ...row, runAt: new Date(row.runAt) }));
}

export type KeywordContentRow = {
  kind: string;
  title: string;
  url: string;
  thumbnailUrl: string | null;
  metricLabel: string | null;
  source: string | null;
};

/** 출처 카드(관련 콘텐츠) 원본. */
export async function dbKeywordContents(keywordId: number): Promise<KeywordContentRow[]> {
  return getDb()
    .select({
      kind: trendContents.kind,
      title: trendContents.title,
      url: trendContents.url,
      thumbnailUrl: trendContents.thumbnailUrl,
      metricLabel: trendContents.metricLabel,
      source: trendContents.source,
    })
    .from(trendContents)
    .where(eq(trendContents.keywordId, keywordId))
    .orderBy(asc(trendContents.rank))
    .limit(12);
}

/** 연관 키워드 칩(용어만) — weight 내림차순. */
export async function dbKeywordRelatedTerms(keywordId: number): Promise<string[]> {
  const rows = await getDb()
    .select({ term: keywordsTable.term })
    .from(keywordRelations)
    .innerJoin(keywordsTable, eq(keywordRelations.relatedKeywordId, keywordsTable.id))
    .where(eq(keywordRelations.keywordId, keywordId))
    .orderBy(desc(keywordRelations.weight))
    .limit(12);

  return rows.map((row) => row.term);
}
