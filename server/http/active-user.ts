import { getUserIdAndIssuedAt, type AuthRequest } from "@/server/http/auth";
import { isSessionRevoked } from "@/server/services/session.service";

/**
 * getUserId()의 폐기 인지(#94) 버전. Express 라우트(backend/server.ts)와 Next.js Route
 * Handler(app/api/**) 양쪽에서 이걸 쓴다 — 두 경로 모두 같은 td-session 쿠키 신뢰 모델을
 * 공유하므로 revocation 검사가 한쪽에만 걸리면 다른 쪽이 우회로가 된다.
 */
export async function getActiveUserId(request: AuthRequest): Promise<number | null> {
  const decoded = getUserIdAndIssuedAt(request);
  if (!decoded) return null;
  if (await isSessionRevoked(decoded.userId, decoded.issuedAt)) return null;
  return decoded.userId;
}
