import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

process.env.AUTH_SESSION_SECRET = "test-secret-do-not-use-in-prod";

/** auth.ts의 sign()과 동일한 알고리즘 — 임의 payload에 대해 "진짜로 올바른" 서명을 만들어야
 * 하는 테스트(예: 서명은 맞지만 만료된 토큰)에 쓴다. */
function signPayload(payload: string) {
  return createHmac("sha256", process.env.AUTH_SESSION_SECRET!).update(payload).digest("base64url");
}

// require: sessionSecret()은 호출 시점에 process.env를 읽으므로, 위 설정이 먼저 끝난 뒤
// 동기적으로 가져와야 한다(top-level await는 이 프로젝트의 CJS 빌드에서 쓸 수 없다).
const { createSession, getUserId, decodeSession } = require("./auth") as typeof import("./auth");

function requestWith(headers: Record<string, string>) {
  return { headers } as unknown as Parameters<typeof getUserId>[0];
}

test("쿠키가 없으면 비로그인으로 취급한다", () => {
  assert.equal(getUserId(requestWith({})), null);
});

test("x-user-id 헤더만으로는 더 이상 신원을 인정하지 않는다 (#53 회귀 가드)", () => {
  assert.equal(getUserId(requestWith({ "x-user-id": "1" })), null);
});

test("유효하게 서명된 세션 쿠키는 그 user id를 반환한다", () => {
  const token = createSession(42);
  assert.equal(getUserId(requestWith({ cookie: `td-session=${token}` })), 42);
});

test("x-user-id 헤더로 서명된 세션의 user id를 덮어쓸 수 없다", () => {
  const token = createSession(42);
  assert.equal(getUserId(requestWith({ "x-user-id": "999", cookie: `td-session=${token}` })), 42);
});

test("서명이 변조된 세션 쿠키는 거부한다", () => {
  const [userId, expiresAt] = createSession(42).split(".");
  const tampered = `${userId}.${expiresAt}.forged-signature`;
  assert.equal(getUserId(requestWith({ cookie: `td-session=${tampered}` })), null);
});

test("userId를 바꿔치기한 세션 쿠키는 거부한다", () => {
  const token = createSession(42);
  const [, expiresAt, signature] = token.split(".");
  const forged = `43.${expiresAt}.${signature}`;
  assert.equal(getUserId(requestWith({ cookie: `td-session=${forged}` })), null);
});

test("decodeSession은 발급시각을 만료시각-SESSION_MAX_AGE로 되돌려 계산한다 (#94 세션 폐기)", () => {
  const before = Math.floor(Date.now() / 1000);
  const decoded = decodeSession(createSession(42));
  assert.ok(decoded);
  assert.equal(decoded!.userId, 42);
  // createSession은 만료시각을 발급시각 + SESSION_MAX_AGE(30일)로 고정해서 만든다 —
  // decodeSession이 거꾸로 계산한 발급시각이 실제 호출 시각과 거의 같아야 한다.
  assert.ok(Math.abs(decoded!.issuedAt - before) <= 2);
});

test("decodeSession도 서명이 변조된 토큰은 거부한다", () => {
  const [userId, expiresAt] = createSession(42).split(".");
  assert.equal(decodeSession(`${userId}.${expiresAt}.forged-signature`), null);
});

test("서명은 올바르지만 만료 시각이 지난 세션 쿠키는 거부한다", () => {
  const payload = `42.${Math.floor(Date.now() / 1000) - 10}`;
  const signature = signPayload(payload);
  // 서명 불일치가 아니라 만료 비교 자체가 거부 사유인지 확인하려고, 이 payload에 대한
  // "진짜" 서명을 직접 계산해서 붙인다(다른 payload의 서명을 재사용하면 서명 검증이
  // 먼저 걸려서 만료 검증이 실제로 동작하는지는 증명하지 못한다).
  assert.equal(getUserId(requestWith({ cookie: `td-session=${payload}.${signature}` })), null);
});
