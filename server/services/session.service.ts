import { isDbConfigured } from "@/db";
import { dbGetSessionTokenMinIat } from "@/server/repositories/user.repository";

/** 토큰 발급시각이 DB의 폐기 기준시각보다 이르면 폐기된 세션이다(#94).
 * 순수 비교만 담당 — DB 조회 실패/미설정 시의 fail 방향은 isSessionRevoked가 결정한다. */
export function isIssuedBeforeRevocation(issuedAtSeconds: number, minIat: Date | null): boolean {
  return minIat !== null && issuedAtSeconds * 1000 < minIat.getTime();
}

/**
 * 세션 폐기 여부. 조회가 실패하거나 DB가 설정되지 않았으면 폐기로 보지 않는다(soft-fail) —
 * 이 함수는 RootLayout을 포함해 로그인한 사용자의 거의 모든 요청 경로를 지난다. 여기서
 * fail-closed로 두면 일시적인 DB 장애 하나가 로그인한 전체 사용자를 통째로 로그아웃시킨다.
 * 서명·만료 검증(server/http/auth.ts)은 이 함수와 무관하게 그대로 강제되므로, 이건 "추가"
 * 방어선이지 세션 유효성의 "유일한" 방어선이 아니다.
 */
export async function isSessionRevoked(userId: number, issuedAtSeconds: number): Promise<boolean> {
  if (!isDbConfigured()) return false;
  try {
    return isIssuedBeforeRevocation(issuedAtSeconds, await dbGetSessionTokenMinIat(userId));
  } catch (error) {
    console.error("[session.service] revocation check failed, treating session as not revoked:", error);
    return false;
  }
}
