/**
 * API 계층 공통 유틸.
 *
 * 이 디렉토리의 모듈들은 `db/unified-schema.ts`(PR #28) 기준으로 쿼리하고,
 * DB가 없거나 아직 통합 스키마로 마이그레이션되기 전이면 mock으로 자동 폴백한다.
 * 폴백 여부는 응답 `meta.source`("db" | "mock")로 항상 드러낸다.
 */
import { isDbConfigured } from "@/db";

export type ApiMeta = {
  /** 이 응답이 실제 DB에서 왔는지, mock 폴백인지. */
  source: "db" | "mock";
  updatedAt: string;
  [key: string]: unknown;
};

export type ApiResult<T> = {
  data: T;
  meta: ApiMeta;
};

/**
 * 404로 내려야 하는 조회 실패.
 * "대상이 없다"는 정상적인 답이므로 mock 폴백 대상이 아니다 — `fromDbOrMock`이 그대로 던진다.
 */
export class NotFoundError extends Error {}

/**
 * DB 경로를 시도하고, 실패하면 mock으로 내려간다.
 *
 * 통합 스키마가 아직 실제 DB에 반영되기 전이라 `column "slug" does not exist` 류의
 * 에러가 정상적으로 발생할 수 있다. 화면이 죽는 것보다 mock으로 그리는 편이 낫고,
 * `meta.source`를 보면 어느 쪽인지 구분되므로 조용한 실패가 아니다.
 */
export async function fromDbOrMock<T>(
  dbQuery: () => Promise<T>,
  mockValue: () => T,
): Promise<{ value: T; source: "db" | "mock" }> {
  if (!isDbConfigured()) {
    return { value: mockValue(), source: "mock" };
  }

  try {
    return { value: await dbQuery(), source: "db" };
  } catch (error) {
    if (error instanceof NotFoundError) throw error;

    console.warn(
      "[api] DB 조회 실패 — mock으로 폴백합니다:",
      error instanceof Error ? error.message : error,
    );
    return { value: mockValue(), source: "mock" };
  }
}

/**
 * 키워드/카테고리 slug. 한글은 그대로 두고 공백만 하이픈으로 바꾼다
 * (로마자 변환을 하면 원문으로 되돌릴 수 없어 mock ↔ DB 매칭이 깨진다).
 * DB 경로에서는 `keywords.slug` 컬럼 값을 그대로 쓰고, 이 함수는 mock 폴백 전용이다.
 */
export function slugify(term: string): string {
  return term
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "2시간 전" 같은 상대 시각. `now`를 인자로 받아 테스트·SSR에서 결정론을 유지한다. */
export function relativeTime(from: Date | null | undefined, now: Date): string {
  if (!from) return "-";

  const diff = now.getTime() - from.getTime();
  if (diff < MINUTE) return "방금 전";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}분 전`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}시간 전`;
  return `${Math.floor(diff / DAY)}일 전`;
}

/** "14:00" 형태의 시:분. 타임존은 서버 기준(Asia/Seoul 배포 가정). */
export function clockLabel(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** 0~100으로 정규화. 전부 같은 값이면 중간값(50)으로 눕힌다. */
export function normalize(values: number[]): number[] {
  if (values.length === 0) return [];

  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min < 0.001) return values.map(() => 50);

  return values.map((value) => Math.round(((value - min) / (max - min)) * 100));
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