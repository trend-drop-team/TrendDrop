import { and, eq } from "drizzle-orm";
import { cache } from "react";

import { getDb } from "@/db";
import { users } from "@/db/schema";

export type OAuthUserRow = { id: number; name: string | null };

export async function dbGetUserById(userId: number): Promise<{ id: number; email: string; name: string | null } | null> {
  const [row] = await getDb()
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

/** RootLayout과 /docs 페이지가 한 렌더에서 각각 role을 조회하므로(category.repository.ts와 같은 이유),
 * cache()로 요청 단위 메모이즈해 실제 쿼리는 userId당 한 번만 나가게 한다. */
export const dbGetUserRole = cache(async function dbGetUserRole(userId: number): Promise<string | null> {
  const [row] = await getDb().select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.role ?? null;
});

/** 세션 폐기 판정(#94)에 쓰는 값. 매 인증 요청마다 조회되므로 cache()로 요청 단위만
 * 중복을 막는다(Express 쪽은 요청마다 새 실행 컨텍스트라 사실상 1회성). */
export const dbGetSessionTokenMinIat = cache(async function dbGetSessionTokenMinIat(userId: number): Promise<Date | null> {
  const [row] = await getDb().select({ v: users.sessionTokenMinIat }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.v ?? null;
});

export async function dbFindUserByProviderId(provider: string, providerId: string): Promise<OAuthUserRow | null> {
  const [row] = await getDb()
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.provider, provider), eq(users.providerId, providerId)))
    .limit(1);
  return row ?? null;
}

export async function dbFindUserByEmail(email: string): Promise<OAuthUserRow | null> {
  const [row] = await getDb().select({ id: users.id, name: users.name }).from(users).where(eq(users.email, email)).limit(1);
  return row ?? null;
}

export async function dbCreateOAuthUser(input: {
  email: string;
  name: string | null;
  provider: string;
  providerId: string;
  emailVerified: boolean;
}): Promise<OAuthUserRow> {
  const [row] = await getDb()
    .insert(users)
    .values({
      email: input.email,
      name: input.name,
      provider: input.provider,
      providerId: input.providerId,
      emailVerifiedAt: input.emailVerified ? new Date() : null,
    })
    .returning({ id: users.id, name: users.name });
  return row;
}

/** 기존 계정에 provider를 연결한다(#83 — 검증된 이메일 매칭, 또는 카카오 placeholder 이메일 하위호환).
 * emailVerified가 false면 emailVerifiedAt을 건드리지 않는다(undefined는 drizzle이 SET절에서 생략한다) —
 * 이미 다른 provider로 검증돼 있던 계정의 검증 상태를 미검증 로그인 하나가 지우면 안 된다. */
export async function dbLinkProviderToUser(
  userId: number,
  input: { provider: string; providerId: string; emailVerified: boolean }
): Promise<void> {
  await getDb()
    .update(users)
    .set({
      provider: input.provider,
      providerId: input.providerId,
      emailVerifiedAt: input.emailVerified ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

export async function dbUpdateUserName(userId: number, name: string): Promise<void> {
  await getDb().update(users).set({ name, updatedAt: new Date() }).where(eq(users.id, userId));
}
