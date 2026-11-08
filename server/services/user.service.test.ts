import assert from "node:assert/strict";
import { test } from "node:test";

import { canViewDocs, isAdminRole } from "./user.service";

test("role이 admin이면 통과시킨다", () => {
  assert.equal(isAdminRole("admin"), true);
});

test("role이 없으면(null) 거부한다", () => {
  assert.equal(isAdminRole(null), false);
});

test("일반 사용자 role은 거부한다", () => {
  assert.equal(isAdminRole("user"), false);
});

test("정의되지 않은 임의의 role 문자열도 거부한다 (화이트리스트 비교 회귀 가드)", () => {
  assert.equal(isAdminRole("editor"), false);
  assert.equal(isAdminRole(""), false);
});

test("대소문자가 다른 'Admin'은 거부한다 (느슨한 비교로 우회되지 않는지 확인)", () => {
  assert.equal(isAdminRole("Admin"), false);
});

// canViewDocs는 /docs 라우트·페이지·레이아웃이 공통으로 쓰는 실제 문지기 함수다(#79).
// 여기서 거부가 뚫리면 세 호출부가 전부 뚫린다.
test("비로그인(userId=null)은 DB 설정과 무관하게 거부한다 (#79 — /docs 접근 부정 테스트)", async () => {
  assert.equal(await canViewDocs(null), false);
});

test("DB 미설정 환경에서는 로그인한 사용자라도 관리자 여부를 확인할 수 없으므로 거부한다 (fail-safe)", async () => {
  assert.equal(process.env.DATABASE_URL, undefined, "이 테스트는 DATABASE_URL이 없는 환경을 전제로 한다");
  assert.equal(await canViewDocs(42), false);
});
