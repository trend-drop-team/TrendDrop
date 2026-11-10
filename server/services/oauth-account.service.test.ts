import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveOAuthUser, type ResolveOAuthUserInput } from "./oauth-account.service";

type FakeRow = { id: number; email: string; name: string | null; provider: string | null; providerId: string | null };

/** 실제 DB 대신 쓰는 인메모리 가짜 저장소. resolveOAuthUser의 repo 매개변수 기본값과
 * 같은 모양(findByProviderId/findByEmail/createUser/linkProvider/updateName)을 흉내 낸다 —
 * 이 프로젝트는 DB를 모킹하지 않고 "DB 미설정" 분기만 테스트하는 게 관례인데, 계정 매칭
 * 분기 로직 자체는 DB 미설정으로는 가릴 수 없어 의존성 주입으로 대신한다. */
function makeFakeRepo(initial: FakeRow[]) {
  const rows = initial.map((row) => ({ ...row }));
  let nextId = rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;

  return {
    rows,
    findByProviderId: async (provider: string, providerId: string) => {
      const row = rows.find((r) => r.provider === provider && r.providerId === providerId);
      return row ? { id: row.id, name: row.name } : null;
    },
    findByEmail: async (email: string) => {
      const row = rows.find((r) => r.email === email);
      return row ? { id: row.id, name: row.name } : null;
    },
    createUser: async (input: { email: string; name: string | null; provider: string; providerId: string; emailVerified: boolean }) => {
      const row: FakeRow = { id: nextId++, email: input.email, name: input.name, provider: input.provider, providerId: input.providerId };
      rows.push(row);
      return { id: row.id, name: row.name };
    },
    linkProvider: async (userId: number, input: { provider: string; providerId: string; emailVerified: boolean }) => {
      const row = rows.find((r) => r.id === userId);
      if (row) { row.provider = input.provider; row.providerId = input.providerId; }
    },
    updateName: async (userId: number, name: string) => {
      const row = rows.find((r) => r.id === userId);
      if (row) row.name = name;
    },
  };
}

function input(overrides: Partial<ResolveOAuthUserInput>): ResolveOAuthUserInput {
  return { provider: "kakao", providerId: "1", email: null, emailVerified: false, name: null, ...overrides };
}

test("#83 핵심 부정 테스트 — 미검증 이메일로는 같은 이메일의 기존 계정에 연결되지 않는다", async () => {
  const repo = makeFakeRepo([{ id: 1, email: "victim@gmail.com", name: "피해자", provider: "google", providerId: "victim-sub" }]);

  const attacker = await resolveOAuthUser(
    input({ provider: "kakao", providerId: "attacker-id", email: "victim@gmail.com", emailVerified: false, name: "공격자" }),
    repo
  );

  assert.notEqual(attacker.id, 1, "미검증 이메일이 같다는 이유로 피해자 계정 id가 재사용되면 안 된다");
  assert.equal(repo.rows.length, 2, "공격자용 새 계정이 별도로 생겨야 한다");
  assert.equal(repo.rows[0]!.provider, "google", "피해자 계정의 provider 연결은 그대로여야 한다");
});

test("검증된 이메일이면 기존 계정에 다른 provider를 정상적으로 연결한다", async () => {
  const repo = makeFakeRepo([{ id: 1, email: "user@gmail.com", name: "유저", provider: "google", providerId: "sub-1" }]);

  const result = await resolveOAuthUser(
    input({ provider: "kakao", providerId: "kakao-9", email: "user@gmail.com", emailVerified: true, name: "유저" }),
    repo
  );

  assert.equal(result.id, 1);
  assert.equal(repo.rows.length, 1, "검증된 이메일 일치는 새 계정을 만들지 않고 기존 계정을 재사용해야 한다");
});

test("provider+providerId가 이미 일치하면 이메일 검증 여부와 무관하게 재로그인으로 처리한다", async () => {
  const repo = makeFakeRepo([{ id: 5, email: "kakao-5@users.trenddrop.local", name: "카카오유저", provider: "kakao", providerId: "5" }]);

  const result = await resolveOAuthUser(
    input({ provider: "kakao", providerId: "5", email: null, emailVerified: false, name: "카카오유저" }),
    repo
  );

  assert.equal(result.id, 5);
  assert.equal(repo.rows.length, 1);
});

test("미검증 로그인은 과거 placeholder 이메일 계정과 하위호환으로 연결된다 (#79 이전 카카오 가입자)", async () => {
  const repo = makeFakeRepo([{ id: 7, email: "kakao-777@users.trenddrop.local", name: null, provider: null, providerId: null }]);

  const result = await resolveOAuthUser(
    input({ provider: "kakao", providerId: "777", email: null, emailVerified: false, name: "닉네임" }),
    repo
  );

  assert.equal(result.id, 7, "기존 placeholder 계정에 연결돼야지 새 계정이 생기면 안 된다");
  assert.equal(repo.rows.length, 1);
  assert.equal(repo.rows[0]!.provider, "kakao");
  assert.equal(repo.rows[0]!.providerId, "777");
});

test("서로 다른 provider가 우연히 같은 이메일이라도 둘 다 미검증이면 계정이 분리된다", async () => {
  const repo = makeFakeRepo([]);

  const a = await resolveOAuthUser(input({ provider: "google", providerId: "g-1", email: "shared@example.com", emailVerified: false, name: "A" }), repo);
  const b = await resolveOAuthUser(input({ provider: "kakao", providerId: "k-1", email: "shared@example.com", emailVerified: false, name: "B" }), repo);

  assert.notEqual(a.id, b.id);
  assert.equal(repo.rows.length, 2);
});

test("이름이 바뀌면 재로그인 시 동기화된다", async () => {
  const repo = makeFakeRepo([{ id: 1, email: "user@gmail.com", name: "옛이름", provider: "google", providerId: "sub-1" }]);

  const result = await resolveOAuthUser(input({ provider: "google", providerId: "sub-1", email: "user@gmail.com", emailVerified: true, name: "새이름" }), repo);

  assert.equal(result.name, "새이름");
  assert.equal(repo.rows[0]!.name, "새이름");
});
