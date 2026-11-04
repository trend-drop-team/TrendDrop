import assert from "node:assert/strict";
import { test } from "node:test";

import { isAllowedOrigin } from "./allowed-origins";

test("허용 목록에 있는 origin은 통과한다", () => {
  assert.equal(isAllowedOrigin("https://trenddrop.vercel.app", ["https://trenddrop.vercel.app"]), true);
});

test("허용 목록에 없는 origin은 거부한다 (#94 cross-site CSRF 방어)", () => {
  assert.equal(isAllowedOrigin("https://evil.example.com", ["https://trenddrop.vercel.app"]), false);
});

test("Origin 헤더가 없으면 거부한다 (허용 목록이 설정된 경우)", () => {
  assert.equal(isAllowedOrigin(null, ["https://trenddrop.vercel.app"]), false);
});

test("허용 목록이 비어 있으면(로컬 개발, FRONTEND_ORIGIN 미설정) 검사를 건너뛴다", () => {
  assert.equal(isAllowedOrigin(null, []), true);
  assert.equal(isAllowedOrigin("http://anything", []), true);
});
