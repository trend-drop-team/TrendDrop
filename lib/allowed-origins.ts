/** FRONTEND_ORIGIN(쉼표 구분)을 공유 형태로 파싱한다 — backend/server.ts의 CORS 설정과
 * 상태변경 라우트의 Origin 검사(#94)가 같은 허용 목록을 봐야 한다. */
export function parseAllowedOrigins(): string[] {
  return (process.env.FRONTEND_ORIGIN ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * 상태변경 라우트(POST/DELETE)의 Origin 헤더 검사(#94).
 *
 * 쿠키를 cross-site(SameSite=None)로 보내야 하는 배포 구성에서는 SameSite 자체가 CSRF를
 * 막아주지 못한다 — 브라우저가 어느 사이트로의 요청이든 쿠키를 자동으로 실어 보내기 때문이다.
 * Origin 헤더는 브라우저가 스푸핑할 수 없으므로, 허용 목록에 없거나 아예 없는 요청은 거부한다.
 *
 * 허용 목록이 비어 있으면(FRONTEND_ORIGIN 미설정) 로컬 개발에서는 검사를 건너뛰지만,
 * 프로덕션에서는 "전체 허용"으로 조용히 빠지지 않도록 즉시 던진다(backend/server.ts의 CORS
 * 가드와 동일한 원칙) — 모듈 최상단이 아니라 호출 시점에 던져야 `next build`의 라우트
 * 정적분석(페이지 데이터 수집)이 이 파일을 평가만 해도 빌드가 깨지는 걸 피한다.
 */
export function isAllowedOrigin(origin: string | null, allowed: string[] = parseAllowedOrigins()): boolean {
  if (allowed.length === 0) {
    // backend/server.ts의 CORS 가드는 모듈 로드 시 1회만 돌아 `!== "development"`로 막아도
    // 안전하지만, 이 함수는 매 요청·단위 테스트에서도 호출된다 — `npm test`는 NODE_ENV를
    // 비워 두므로 같은 조건을 쓰면 테스트가 전부 깨진다. Next.js/Vercel 배포는 `next build`·
    // `next start`가 NODE_ENV를 항상 정확히 "production"으로 고정하므로 이 비교로 충분하다.
    if (process.env.NODE_ENV === "production") {
      throw new Error("FRONTEND_ORIGIN is not set. 상태변경 라우트의 Origin 검사(#94)가 전체 허용으로 빠집니다.");
    }
    return true;
  }
  return origin !== null && allowed.includes(origin);
}
