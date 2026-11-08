import { isDbConfigured } from "@/db";
import { dbGetUserRole } from "@/server/repositories/user.repository";

/** 'admin' 외 값(null 포함)은 전부 비관리자 — 화이트리스트 비교, 역할 체계가 늘어도 안전한 기본값. */
export function isAdminRole(role: string | null): boolean {
  return role === "admin";
}

/**
 * role 조회는 RootLayout의 Promise.all 안에서 모든 페이지마다 돈다(탭바에 "문서"를 보일지
 * 결정하려고) — 여기서 던지면 일시적인 DB 장애 하나가 문서와 무관한 페이지 전체를 500으로
 * 떨어뜨린다. 권한 판정은 모호하면 거부하는 쪽이 안전하므로, 조회 실패도 비관리자로 접어둔다.
 */
export async function isAdmin(userId: number): Promise<boolean> {
  if (!isDbConfigured()) return false;
  try {
    return isAdminRole(await dbGetUserRole(userId));
  } catch (error) {
    console.error("[user.service] role lookup failed, denying admin access:", error);
    return false;
  }
}

/**
 * `/docs` 접근 판정의 단일 소스(#79). 비로그인(null)은 DB를 보지도 않고 바로 거부 —
 * 호출부(layout.tsx·app/docs/**)가 이 판정을 각자 다시 조립하지 않게 여기 한 곳에 모은다.
 */
export async function canViewDocs(userId: number | null): Promise<boolean> {
  return userId !== null && (await isAdmin(userId));
}
