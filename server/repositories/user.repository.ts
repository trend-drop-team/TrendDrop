import { eq } from "drizzle-orm";
import { cache } from "react";

import { getDb } from "@/db";
import { users } from "@/db/schema";

/** RootLayout과 /docs 페이지가 한 렌더에서 각각 role을 조회하므로(category.repository.ts와 같은 이유),
 * cache()로 요청 단위 메모이즈해 실제 쿼리는 userId당 한 번만 나가게 한다. */
export const dbGetUserRole = cache(async function dbGetUserRole(userId: number): Promise<string | null> {
  const [row] = await getDb().select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.role ?? null;
});
