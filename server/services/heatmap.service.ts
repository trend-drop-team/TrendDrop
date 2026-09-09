import { isDbConfigured } from "@/db";
import { clockLabel, nowIso, relativeTime } from "@/lib/utils/date";
import { mockHeatmap } from "@/mocks/trends/repository";
import { dbHeatmapIngredients, type HeatmapIngredients } from "@/server/repositories/heatmap.repository";
import { byRank } from "@/server/repositories/shared";
import type { ApiResult } from "@/types/api/common";
import type { HeatmapPayload } from "@/types/api/heatmap";

/**
 * 시점별로 "상위권일수록 큰 가중치"를 합산한 뒤 그 시점 최댓값 기준 0~100으로 정규화한다.
 * (mock의 getCategoryHeat와 같은 규칙 — 열끼리 비교하는 게 아니라 열 안에서의 분포를 본다.)
 */
function buildHeatmap({ runs, rows, categoryOrder }: HeatmapIngredients): HeatmapPayload {
  const sortIndex = new Map(categoryOrder.map((row) => [row.name, row.sortOrder]));
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

/** 3.5 GET /api/explore/heatmap */
export async function getHeatmap(windowHours: number): Promise<ApiResult<HeatmapPayload>> {
  let data: HeatmapPayload | null = null;
  let source: "db" | "mock" = isDbConfigured() ? "db" : "mock";

  if (isDbConfigured()) {
    const ingredients = await dbHeatmapIngredients(windowHours);
    // 창 안에 run/스냅샷이 없는 건 방금 띄운 DB처럼 정상적으로 비어 있을 수 있는 상태다 —
    // 쿼리 실패가 아니므로 예외를 던지지 않고 여기서 명시적으로 mock으로 넘어간다.
    if (ingredients.runs.length > 0 && ingredients.rows.length > 0) {
      data = buildHeatmap(ingredients);
    }
  }

  if (!data) {
    data = mockHeatmap();
    source = "mock";
  }

  return { data, meta: { source, updatedAt: nowIso(), windowHours } };
}
