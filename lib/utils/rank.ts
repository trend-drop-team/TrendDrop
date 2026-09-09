export type RankDelta = {
  kind: "up" | "down" | "new" | "same";
  diff: number;
};

/** 구조적 타입으로 받아 API `TrendRow`와 mock `RankedItem` 양쪽에 모두 쓸 수 있다. */
export function getRankDelta(item: { rank: number; previousRank?: number | null }): RankDelta {
  const previous = item.previousRank;

  if (previous === null || previous === undefined) {
    return { kind: "new", diff: 0 };
  }

  const diff = previous - item.rank;

  if (diff > 0) return { kind: "up", diff };
  if (diff < 0) return { kind: "down", diff: Math.abs(diff) };
  return { kind: "same", diff: 0 };
}
