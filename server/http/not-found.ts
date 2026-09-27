/**
 * 404로 내려야 하는 조회 실패.
 * "대상이 없다"는 정상적인 답이므로 mock 폴백 대상이 아니다 — `fromDbOrMock`이 그대로 던진다.
 *
 * `errors.ts`가 아니라 별도 모듈로 둔다: Express 백엔드(backend/server.ts)가 상태 코드를
 * 가르려면 이 클래스가 필요한데, `errors.ts`는 `next/server`를 import하기 때문이다.
 */
export class NotFoundError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
