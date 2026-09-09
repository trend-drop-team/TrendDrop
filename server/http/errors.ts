/**
 * 라우트 핸들러 공통 — 에러 응답 형태와 상태 코드.
 * 스펙 2절: 에러는 `{ error, detail? }`, 상태 코드는 400/401/404/500.
 */
import { NextResponse } from "next/server";

/**
 * 404로 내려야 하는 조회 실패.
 * "대상이 없다"는 정상적인 답이므로 mock 폴백 대상이 아니다 — `fromDbOrMock`이 그대로 던진다.
 */
export class NotFoundError extends Error {}

export function errorResponse(message: string, status: number, detail?: string) {
  return NextResponse.json(detail ? { error: message, detail } : { error: message }, { status });
}

/** 예상 못 한 예외를 스펙 형태로 감싼다. NotFoundError만 404로 갈라 보낸다. */
export function handleRouteError(error: unknown, fallbackMessage: string) {
  if (error instanceof NotFoundError) {
    return errorResponse("not found", 404, error.message);
  }

  return errorResponse(
    fallbackMessage,
    500,
    error instanceof Error ? error.message : "Unknown error",
  );
}
