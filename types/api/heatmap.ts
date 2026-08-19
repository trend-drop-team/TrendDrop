import type { RunColumn } from "@/types/api/trend";

/** 3.5 GET /api/explore/heatmap */
export type HeatmapPayload = {
  columns: RunColumn[];
  categories: string[];
  /** matrix[카테고리행][시점열] = heat(0~100) */
  matrix: number[][];
};
