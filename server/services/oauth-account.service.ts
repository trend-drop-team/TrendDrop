import {
  dbCreateOAuthUser,
  dbFindUserByEmail,
  dbFindUserByProviderId,
  dbLinkProviderToUser,
  dbUpdateUserName,
  type OAuthUserRow,
} from "@/server/repositories/user.repository";

export type ResolveOAuthUserInput = {
  provider: string;
  providerId: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
};

type OAuthUserRepo = {
  findByProviderId: typeof dbFindUserByProviderId;
  findByEmail: typeof dbFindUserByEmail;
  createUser: typeof dbCreateOAuthUser;
  linkProvider: typeof dbLinkProviderToUser;
  updateName: typeof dbUpdateUserName;
};

const defaultRepo: OAuthUserRepo = {
  findByProviderId: dbFindUserByProviderId,
  findByEmail: dbFindUserByEmail,
  createUser: dbCreateOAuthUser,
  linkProvider: dbLinkProviderToUser,
  updateName: dbUpdateUserName,
};

/** provider+providerId만으로 결정되는 하위호환 placeholder — 동의 없음/미검증 이메일로 가입한
 * 계정의 신원 키다. providerId에서 결정론적으로 나오므로 다른 사용자와 절대 충돌하지 않는다.
 * 카카오의 기존 `kakao-{id}@users.trenddrop.local` 포맷과 동일해, 이메일 동의가 없던 기존
 * 카카오 가입자가 이 PR 이후 재로그인해도 같은 placeholder로 매칭되어 새 계정이 생기지 않는다. */
function placeholderEmail(provider: string, providerId: string): string {
  return `${provider}-${providerId}@users.trenddrop.local`;
}

async function syncName(user: OAuthUserRow, name: string | null, repo: OAuthUserRepo): Promise<OAuthUserRow> {
  if (name && name !== user.name) {
    await repo.updateName(user.id, name);
    return { id: user.id, name };
  }
  return user;
}

/**
 * OAuth 콜백에서 "이 사람은 어느 계정인가"를 정한다(#83).
 *
 * 검증되지 않은 이메일은 절대 계정 매칭에 쓰지 않는다. provider가 이메일 소유를 보증하지
 * 않는 경우(email_verified=false, 동의 자체가 없는 경우 등) 같은 이메일 문자열이 이미
 * 존재해도 그 계정에 연결하지 않는다 — 그러지 않으면 공격자가 피해자와 같은 이메일을
 * 미검증 상태로 등록해 피해자의 기존 계정에 그대로 로그인하게 된다(계정 탈취).
 *
 * 우선순위: ① provider+providerId 완전 일치(재로그인) → 그 계정 ② 검증된 이메일 일치 →
 * 그 계정에 provider 연결(합법적인 다른 provider 추가 로그인) ③ 그 외 → provider+providerId로만
 * 식별되는 새 계정(또는 과거 placeholder 계정과의 하위호환 연결).
 */
export async function resolveOAuthUser(
  input: ResolveOAuthUserInput,
  repo: OAuthUserRepo = defaultRepo
): Promise<OAuthUserRow> {
  const byProvider = await repo.findByProviderId(input.provider, input.providerId);
  if (byProvider) return syncName(byProvider, input.name, repo);

  if (input.emailVerified && input.email) {
    const byEmail = await repo.findByEmail(input.email);
    if (byEmail) {
      await repo.linkProvider(byEmail.id, { provider: input.provider, providerId: input.providerId, emailVerified: true });
      return syncName(byEmail, input.name, repo);
    }
    const created = await repo.createUser({
      email: input.email,
      name: input.name,
      provider: input.provider,
      providerId: input.providerId,
      emailVerified: true,
    });
    return created;
  }

  const placeholder = placeholderEmail(input.provider, input.providerId);
  const byPlaceholder = await repo.findByEmail(placeholder);
  if (byPlaceholder) {
    await repo.linkProvider(byPlaceholder.id, { provider: input.provider, providerId: input.providerId, emailVerified: false });
    return syncName(byPlaceholder, input.name, repo);
  }
  return repo.createUser({
    email: placeholder,
    name: input.name,
    provider: input.provider,
    providerId: input.providerId,
    emailVerified: false,
  });
}
