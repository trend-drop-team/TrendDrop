/**
 * API base URL — 브라우저 코드와 서버 렌더링이 함께 쓴다.
 *
 * 프로덕션에서 `NEXT_PUBLIC_API_URL`이 비면 조용히 폴백하지 않고 던진다.
 * 폴백을 남겨 두면 서버는 localhost:4000(ECONNREFUSED), 브라우저는 same-origin
 * (Vercel에 남아 있는 Next API 라우트)으로 갈라져서 "서버와 클라이언트가 서로 다른
 * 백엔드를 보는데 에러는 안 나는" 상태가 된다. 설정 누락은 조용한 반쪽 동작보다
 * 즉시 실패가 낫다.
 */
function devFallback(): string {
  // 로컬 개발 — 서버는 같은 머신의 Express 백엔드를, 브라우저는 same-origin(Next API 라우트)을 본다.
  return typeof window === "undefined"
    ? `http://localhost:${process.env.BACKEND_PORT ?? 4000}`
    : "";
}

export function apiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  if (configured) return configured;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXT_PUBLIC_API_URL is not set. 백엔드 주소를 넣어야 합니다 (예: https://trenddrop-api.onrender.com).",
    );
  }

  return devFallback();
}

export function apiUrl(path: string): string {
  return `${apiBase()}${path}`;
}
