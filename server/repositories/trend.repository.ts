import { desc, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { collectionRuns } from "@/db/schema";
import {
  recentRuns,
  RUN_AT,
  snapshotsForRuns,
  type RunRow,
  type SnapshotRow,
} from "@/server/repositories/shared";

export type TrendIngredients = {
  runs: RunRow[];
  rows: SnapshotRow[];
};

/**
 * 최근 `runCount`개 run과 그 run들의 스냅샷 원본. 랭킹·티커·스파크 계산은 service가 한다.
 * 타임머신 슬라이더·히트맵·홈 랭킹이 모두 이 한 번의 조회를 공유한다.
 */
export async function dbTimelineIngredients(runCount: number): Promise<TrendIngredients> {
  const runs = await recentRuns(runCount);
  const rows = await snapshotsForRuns(runs.map((run) => run.id));
  return { runs, rows };
}

/**
 * 최근 24시간 run과 그 run들의 스냅샷 원본. 통합 스키마에 "일간" run 종류가 따로 없으므로
 * 이 창 안의 run들을 service가 키워드별 평균 score로 재순위한다.
 */
export async function dbDailyIngredients(): Promise<TrendIngredients> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // `RUN_AT`은 컬럼이 아니라 raw sql 조각이라 drizzle의 gte()에 Date를 직접 넘기면
  // 파라미터 타입을 못 정해 런타임 에러가 난다 — ISO 문자열로 비교한다.
  const runs: RunRow[] = (
    await getDb()
      .select({ id: collectionRuns.id, at: RUN_AT })
      .from(collectionRuns)
      .where(sql`${RUN_AT} >= ${since.toISOString()}`)
      .orderBy(desc(RUN_AT))
  ).map((run) => ({ id: run.id, at: new Date(run.at) }));

  const rows = await snapshotsForRuns(runs.map((run) => run.id));
  return { runs, rows };
}
