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

const KST_TIME_ZONE = "Asia/Seoul";

const kstClockFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: KST_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const kstDateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: KST_TIME_ZONE,
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function toDate(input: Date | string): Date {
  return typeof input === "string" ? new Date(input) : input;
}

/** "14:00" 형태의 시:분. 서버 OS 시간대에 기대지 않고 Asia/Seoul로 명시 고정. */
export function clockLabel(date: Date | string): string {
  return kstClockFormatter.format(toDate(date));
}

/** "2026년 1월 15일 14:00" 형태. 타임라인 등 날짜+시각 표시용, Asia/Seoul로 명시 고정. */
export function dateTimeLabel(date: Date | string): string {
  return kstDateTimeFormatter.format(toDate(date));
}

/** 응답 `meta.updatedAt`용 ISO 8601 현재 시각. */
export function nowIso(): string {
  return new Date().toISOString();
}
