/**
 * 라우트 핸들러 공통 — 에러 응답 형태와 인증 경계.
 * 스펙 2절: 에러는 `{ error, detail? }`, 상태 코드는 400/401/404/500.
 */
import { NextResponse } from "next/server";

import { NotFoundError } from "@/lib/api/common";

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

/**
 * 요청자의 user_id.
 *
 * 세션·토큰 발급은 스펙 범위 밖(3.6절 비고)이라 아직 없다. 그때까지의 임시 경계로
 * `x-user-id` 헤더 또는 `td-user` 쿠키의 숫자 id를 읽고, 없으면 401로 막는다.
 * 로그인이 붙으면 이 함수 하나만 세션 조회로 바꾸면 된다.
 *
 * TODO(auth): 서명된 세션으로 교체 — 지금 값은 클라이언트가 마음대로 바꿀 수 있다.
 */
export function getUserId(request: Request): number | null {
  const header = request.headers.get("x-user-id");
  if (header) {
    const value = Number.parseInt(header, 10);
    if (Number.isFinite(value) && value > 0) return value;
  }

  const cookie = request.headers.get("cookie");
  if (!cookie) return null;

  const match = /(?:^|;\s*)td-user=(\d+)/.exec(cookie);
  if (!match) return null;

  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}