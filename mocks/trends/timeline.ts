import { realtimeTrends } from "@/mocks/trends/data";

/**
 * 시계열 스냅샷 레이어.
 *
 * 하이드레이션 안전을 위해 이 모듈은 **완전히 결정론적**이다.
 * - Math.random / Date.now / new Date 를 쓰지 않는다.
 * - 모든 흔들림은 고정 시드 PRNG(mulberry32)와 순수 함수(sin)에서 나온다.
 * 따라서 서버와 클라이언트가 같은 값을 만들어내고, 몇 번을 실행해도 결과가 같다.
 */

export type RankedItem = {
  keyword: string;
  category: string;
  rank: number;
  /** 직전 스냅샷 기준 순위. null이면 이번 스냅샷에서 처음 등장(NEW). */
  previousRank: number | null;
  growth: string;
  velocity: string;
  score: number;
  spark: number[];
};

export type Snapshot = {
  id: number;
  /** "14:00" 같은 고정 문자열 (렌더 중 시간 계산 금지) */
  clock: string;
  /** "12시간 전" … "지금" */
  label: string;
  items: RankedItem[];
};

export type SeriesPoint = { snapshotId: number; rank: number | null; score: number };
export type CategoryHeat = { category: string; heat: number; count: number };
export type TickerItem = { keyword: string; kind: "new" | "surge"; delta: number };

const SNAPSHOT_COUNT = 12;
/** 내부 프레임은 스냅샷보다 하나 많다 — 0번 스냅샷도 직전 프레임을 갖도록. */
const FRAME_COUNT = SNAPSHOT_COUNT + 1;
const SEED = 20260715;
const BASE_HOUR = 14;
const SPARK_WINDOW = 7;

/** 10줄짜리 고정 시드 PRNG. 같은 시드 → 항상 같은 수열. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseGrowth(raw: string): number {
  const digits = raw.replace(/[^0-9]/g, "");
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? value : 50;
}

/** 뒤늦게 진입하는 키워드 → 해당 프레임에서 NEW로 등장하고 이후 급등한다. */
const LATE_ENTRY_FRAMES: Record<string, number> = {
  "편의점 신상 디저트": 4,
  "두바이 초콜릿": 6,
  "저속노화 식단": 9,
};

type KeywordSeed = {
  keyword: string;
  category: string;
  velocity: string;
  baseScore: number;
  baseGrowth: number;
  drift: number;
  wave: number;
  phase: number;
  entryFrame: number;
};

const seeds: KeywordSeed[] = (() => {
  const rand = mulberry32(SEED);
  return realtimeTrends.map((trend, index) => ({
    keyword: trend.keyword,
    category: trend.category,
    velocity: trend.velocity,
    baseScore: 100 - index * 2.4,
    baseGrowth: parseGrowth(trend.growth),
    // 아래 세 값은 시드 순서에 의존하므로 map 순서가 곧 결정론의 일부다.
    drift: (rand() * 2 - 1) * 1.5,
    wave: 1 + rand() * 2.6,
    phase: rand() * Math.PI * 2,
    entryFrame: LATE_ENTRY_FRAMES[trend.keyword] ?? 0,
  }));
})();

function scoreAt(seed: KeywordSeed, frame: number): number {
  const drift = seed.drift * frame;
  const wave = Math.sin(seed.phase + frame * 0.55) * seed.wave;
  // 늦게 진입한 키워드는 진입 직후 가파르게 치솟는다.
  const surge = seed.entryFrame > 0 ? Math.max(0, frame - seed.entryFrame) * 3.4 : 0;
  return seed.baseScore + drift + wave + surge;
}

type Frame = {
  order: { keyword: string; score: number; rank: number }[];
  rankByKeyword: Map<string, number>;
  scoreByKeyword: Map<string, number>;
};

const frames: Frame[] = Array.from({ length: FRAME_COUNT }, (_, frame) => {
  const scored = seeds
    .filter((seed) => frame >= seed.entryFrame)
    .map((seed) => ({ keyword: seed.keyword, score: scoreAt(seed, frame) }));

  // 점수 동률일 때도 순서가 흔들리지 않도록 키워드로 안정 정렬한다.
  scored.sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword));

  const order = scored.map((entry, index) => ({ ...entry, rank: index + 1 }));

  return {
    order,
    rankByKeyword: new Map(order.map((entry) => [entry.keyword, entry.rank])),
    scoreByKeyword: new Map(order.map((entry) => [entry.keyword, entry.score])),
  };
});

const seedByKeyword = new Map(seeds.map((seed) => [seed.keyword, seed]));

function buildSpark(keyword: string, frame: number): number[] {
  const values: number[] = [];
  for (let f = Math.max(0, frame - (SPARK_WINDOW - 1)); f <= frame; f += 1) {
    const score = frames[f]?.scoreByKeyword.get(keyword);
    if (score !== undefined) values.push(score);
  }
  if (values.length === 0) return [50];

  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min < 0.001) return values.map(() => 50);
  return values.map((value) => Math.round(((value - min) / (max - min)) * 100));
}

function clockFor(id: number): string {
  const hour = (BASE_HOUR - (SNAPSHOT_COUNT - 1 - id) + 24) % 24;
  return `${String(hour).padStart(2, "0")}:00`;
}

function labelFor(id: number): string {
  const hoursAgo = SNAPSHOT_COUNT - 1 - id;
  return hoursAgo === 0 ? "지금" : `${hoursAgo}시간 전`;
}

export const snapshots: Snapshot[] = Array.from({ length: SNAPSHOT_COUNT }, (_, id) => {
  const frame = id + 1;
  const current = frames[frame];
  const previous = frames[frame - 1];

  const items: RankedItem[] = current.order.map((entry) => {
    const seed = seedByKeyword.get(entry.keyword);
    const previousRank = previous.rankByKeyword.get(entry.keyword) ?? null;
    const previousScore = previous.scoreByKeyword.get(entry.keyword) ?? entry.score;
    const momentum = entry.score - previousScore;
    const baseGrowth = seed?.baseGrowth ?? 50;
    const growthValue = Math.max(8, Math.round(baseGrowth * (1 + momentum * 0.1)));

    return {
      keyword: entry.keyword,
      category: seed?.category ?? "기타",
      rank: entry.rank,
      previousRank,
      growth: `+${growthValue}%`,
      velocity: seed?.velocity ?? "-",
      score: Math.round(entry.score),
      spark: buildSpark(entry.keyword, frame),
    };
  });

  return { id, clock: clockFor(id), label: labelFor(id), items };
});

export const latestSnapshot: Snapshot = snapshots[snapshots.length - 1];

/** 특정 키워드의 전체 순위/점수 궤적 (2단계 타임머신·비교용). */
export function getSeriesForKeyword(keyword: string): SeriesPoint[] {
  return snapshots.map((snapshot) => {
    const item = snapshot.items.find((entry) => entry.keyword === keyword);
    return {
      snapshotId: snapshot.id,
      rank: item ? item.rank : null,
      score: item ? item.score : 0,
    };
  });
}

/** 스냅샷 시점의 카테고리별 열기 (2단계 히트맵용). heat는 0~100. */
export function getCategoryHeat(snapshotId: number): CategoryHeat[] {
  const snapshot = snapshots.find((entry) => entry.id === snapshotId);
  if (!snapshot) return [];

  const total = snapshot.items.length;
  const buckets = new Map<string, { sum: number; count: number }>();

  for (const item of snapshot.items) {
    const bucket = buckets.get(item.category) ?? { sum: 0, count: 0 };
    // 상위권일수록 큰 가중치 (1위 = total점)
    bucket.sum += total - item.rank + 1;
    bucket.count += 1;
    buckets.set(item.category, bucket);
  }

  const rows = [...buckets.entries()].map(([category, bucket]) => ({
    category,
    raw: bucket.sum,
    count: bucket.count,
  }));

  const maxRaw = rows.reduce((max, row) => Math.max(max, row.raw), 0);

  return rows
    .map((row) => ({
      category: row.category,
      heat: maxRaw > 0 ? Math.round((row.raw / maxRaw) * 100) : 0,
      count: row.count,
    }))
    .sort((a, b) => b.heat - a.heat);
}

/** 티커용 하이라이트: 신규 진입과 급상승. */
export function getTickerItems(snapshotId: number): TickerItem[] {
  const snapshot = snapshots.find((entry) => entry.id === snapshotId);
  if (!snapshot) return [];

  const items: TickerItem[] = [];

  for (const item of snapshot.items) {
    if (item.previousRank === null) {
      items.push({ keyword: item.keyword, kind: "new", delta: 0 });
    } else if (item.previousRank - item.rank >= 2) {
      items.push({ keyword: item.keyword, kind: "surge", delta: item.previousRank - item.rank });
    }
  }

  return items
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "new" ? -1 : 1;
      return b.delta - a.delta;
    })
    .slice(0, 8);
}
