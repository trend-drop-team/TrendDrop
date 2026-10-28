import { cookies } from "next/headers";

import { verifySession } from "@/server/http/auth";
import { canViewDocs } from "@/server/services/user.service";

/**
 * getUserId()의 Server Component 버전. Route Handler는 Request를 직접 받지만
 * RootLayout·`/docs` 페이지 같은 Server Component는 Request가 없어 next/headers로 쿠키를 읽는다.
 */
export async function getCurrentUserId(): Promise<number | null> {
  const session = (await cookies()).get("td-session")?.value;
  return session ? verifySession(session) : null;
}

/**
 * `/docs` 접근 가능 여부를 Server Component 하나에서 바로 물을 때 쓴다(#79).
 * `getCurrentUserId().then(canViewDocs)` 조합을 호출부(layout.tsx·app/docs/**)마다
 * 다시 쓰지 않도록 여기 한 곳에 모은다.
 */
export async function currentUserCanViewDocs(): Promise<boolean> {
  return canViewDocs(await getCurrentUserId());
}
