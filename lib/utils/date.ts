const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 이 시간 이상 지난 수집 데이터는 "오래됨"으로 표시한다(수집 1h + 랭킹 재계산 2h 주기 기준). */
export const STALE_THRESHOLD_MS = 3 * HOUR;

/** "2시간 전" 같은 상대 시각. `now`를 인자로 받아 테스트·SSR에서 결정론을 유지한다. */
export function relativeTime(from: Date | null | undefined, now: Date): string {
  if (!from) return "-";

  const diff = now.getTime() - from.getTime();
  if (diff < MINUTE) return "방금 전";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}분 전`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}시간 전`;
  return `${Math.floor(diff / DAY)}일 전`;
}

/** 마지막 수집이 STALE_THRESHOLD_MS 이상 지났는지. */
export function isStale(from: Date | null | undefined, now: Date): boolean {
  if (!from) return true;
  return now.getTime() - from.getTime() >= STALE_THRESHOLD_MS;
}

/** "14:00" 형태의 시:분. 타임존은 서버 기준(Asia/Seoul 배포 가정). */
export function clockLabel(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** 응답 `meta.updatedAt`용 ISO 8601 현재 시각. */
export function nowIso(): string {
  return new Date().toISOString();
}
