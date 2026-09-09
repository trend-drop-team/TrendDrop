import { asc, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { categories as categoriesTable, collectionRuns } from "@/db/schema";
import { RUN_AT, snapshotsForRuns, type RunRow, type SnapshotRow } from "@/server/repositories/shared";

export type CategoryOrderRow = { name: string; sortOrder: number };

export type HeatmapIngredients = {
  /** 오래된 → 최신 순, 창(window) 안의 run. */
  runs: RunRow[];
  rows: SnapshotRow[];
  categoryOrder: CategoryOrderRow[];
};

/**
 * 히트맵 계산에 필요한 원본 데이터만 가져온다. heat 정규화·행렬 조립은 service가 한다.
 */
export async function dbHeatmapIngredients(windowHours: number): Promise<HeatmapIngredients> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  // `RUN_AT`은 컬럼이 아니라 raw sql 조각이라 `gte()`에 Date를 직접 넘기면
  // 드라이버가 파라미터 타입을 못 정해 런타임 에러가 난다 — ISO 문자열로 비교한다.
  const runs: RunRow[] = (
    await getDb()
      .select({ id: collectionRuns.id, at: RUN_AT })
      .from(collectionRuns)
      .where(sql`${RUN_AT} >= ${since.toISOString()}`)
      .orderBy(asc(RUN_AT))
  ).map((run) => ({ id: run.id, at: new Date(run.at) }));

  const rows = await snapshotsForRuns(runs.map((run) => run.id));

  const categoryOrder = await getDb()
    .select({ name: categoriesTable.name, sortOrder: categoriesTable.sortOrder })
    .from(categoriesTable)
    .orderBy(asc(categoriesTable.sortOrder));

  return { runs, rows, categoryOrder };
}
