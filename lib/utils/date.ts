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

const kstDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: KST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** KST 기준 "YYYY-MM-DD" — 같은 날인지 비교용. */
export function kstDayKey(date: Date | string): string {
  return kstDayFormatter.format(toDate(date));
}

/** KST 기준 "YYYY-MM-DDTHH" — 같은 시간 버킷인지 비교용. */
export function kstHourKey(date: Date | string): string {
  return `${kstDayKey(date)}T${clockLabel(date).slice(0, 2)}`;
}

/**
 * 시간 순서대로 놓인 시각들의 x축 라벨(#125).
 * 시:분만 쓰면 날짜가 넘어갈 때 "20:00 · 17:00"처럼 시간이 거꾸로 가는 것처럼 보인다 —
 * 날짜가 바뀌는 첫 점(그리고 오늘이 아닌 첫 점)에는 "11/7 17:00"처럼 날짜를 붙인다.
 */
export function axisLabels(dates: (Date | string)[], now: Date | string = new Date()): string[] {
  const today = kstDayKey(now);
  return dates.map((date, index) => {
    const day = kstDayKey(date);
    const changed = index === 0 ? day !== today : day !== kstDayKey(dates[index - 1]);
    if (!changed) return clockLabel(date);
    const [, month, dayOfMonth] = day.split("-");
    return `${Number(month)}/${Number(dayOfMonth)} ${clockLabel(date)}`;
  });
}

/** "2026년 1월 15일 14:00" 형태. 타임라인 등 날짜+시각 표시용, Asia/Seoul로 명시 고정. */
export function dateTimeLabel(date: Date | string): string {
  return kstDateTimeFormatter.format(toDate(date));
}

/** 응답 `meta.updatedAt`용 ISO 8601 현재 시각. */
export function nowIso(): string {
  return new Date().toISOString();
}
