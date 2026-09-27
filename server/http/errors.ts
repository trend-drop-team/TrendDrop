/**
 * 라우트 핸들러 공통 — 에러 응답 형태와 상태 코드.
 * 스펙 2절: 에러는 `{ error, detail? }`, 상태 코드는 400/401/404/500.
 */
import { NextResponse } from "next/server";

import { NotFoundError } from "./not-found";

// NotFoundError는 next/server에 묶이지 않도록 별도 모듈에 있다(Express 백엔드가 같이 쓴다).
export { NotFoundError } from "./not-found";

export function errorResponse(message: string, status: number, detail?: string) {
  return NextResponse.json(detail ? { error: message, detail } : { error: message }, { status });
}

/**
 * 예상 못 한 예외를 스펙 형태로 감싼다. NotFoundError만 404로 갈라 보낸다.
 *
 * 500일 때 내부 메시지를 detail로 실어 보내지 않는다 — DB 드라이버 에러에는 호스트·포트·
 * 컬럼명 같은 내부 정보가 섞여 나온다. 원인은 서버 로그에만 남긴다.
 * (backend/server.ts의 에러 핸들러와 같은 규칙을 쓴다)
 */
export function handleRouteError(error: unknown, fallbackMessage: string) {
  if (error instanceof NotFoundError) {
    return errorResponse("not found", 404, error.message);
  }

  console.error(`[api] ${fallbackMessage}:`, error);
  return errorResponse(fallbackMessage, 500);
}
