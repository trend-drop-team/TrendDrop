import assert from "node:assert/strict";
import { test } from "node:test";

import { isIssuedBeforeRevocation, isSessionRevoked } from "./session.service";

test("발급시각이 폐기 기준시각보다 이르면 폐기된 것으로 본다 (#94)", () => {
  const minIat = new Date("2026-01-01T00:00:00Z");
  const issuedAtSeconds = Math.floor(new Date("2025-12-31T00:00:00Z").getTime() / 1000);
  assert.equal(isIssuedBeforeRevocation(issuedAtSeconds, minIat), true);
});

test("발급시각이 폐기 기준시각과 같거나 이후면 유효하다", () => {
  const minIat = new Date("2026-01-01T00:00:00Z");
  const after = Math.floor(new Date("2026-01-02T00:00:00Z").getTime() / 1000);
  assert.equal(isIssuedBeforeRevocation(after, minIat), false);
});

test("폐기 기준시각이 없으면(null) 폐기된 적 없는 것으로 본다", () => {
  assert.equal(isIssuedBeforeRevocation(0, null), false);
});

test("DB 미설정 환경에서는 세션을 폐기된 것으로 보지 않는다 (soft-fail — RootLayout 등 모든 페이지가 지나는 경로)", async () => {
  assert.equal(process.env.DATABASE_URL, undefined, "이 테스트는 DATABASE_URL이 없는 환경을 전제로 한다");
  assert.equal(await isSessionRevoked(1, 0), false);
});
