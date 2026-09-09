/** 쿼리 파라미터 파서 — route.ts가 `searchParams`를 읽을 때 공통으로 쓴다. */

export type TrendPeriod = "realtime" | "daily";

export function parsePeriod(raw: string | null): TrendPeriod {
  return raw === "daily" ? "daily" : "realtime";
}

/** `?window=12h` 파싱. 허용 범위를 벗어나면 기본 12시간. */
export function parseWindowHours(raw: string | null, fallback = 12): number {
  if (!raw) return fallback;

  const match = /^(\d+)\s*h?$/i.exec(raw.trim());
  if (!match) return fallback;

  const hours = Number.parseInt(match[1], 10);
  if (!Number.isFinite(hours) || hours < 1 || hours > 24 * 30) return fallback;
  return hours;
}

/** `?limit=30` 파싱. 1~200으로 클램프. */
export function parseLimit(raw: string | null, fallback = 30): number {
  if (!raw) return fallback;

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, 1), 200);
}

/** `?runId=482` 파싱. 숫자가 아니면 null(=최신 run). */
export function parseRunId(raw: string | null): number | null {
  if (!raw) return null;

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}
