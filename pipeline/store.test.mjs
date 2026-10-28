import { test } from "node:test";
import assert from "node:assert/strict";
// store.mjs는 postgres를 지연 import하므로 DATABASE_URL 없이 불러도 DB에 붙지 않는다
import { formatGrowthRate } from "./store.mjs";

test("formatGrowthRate: 이전 점수가 없으면(첫 등장 run) 언급 수", () => {
  assert.equal(formatGrowthRate(50, 7, undefined), "7회 언급");
  assert.equal(formatGrowthRate(50, 7, null), "7회 언급");
  assert.equal(formatGrowthRate(50, undefined, undefined), "0회 언급");
});

test("formatGrowthRate: 이전 점수 0이면 NEW", () => {
  assert.equal(formatGrowthRate(50, 7, 0), "NEW");
});

test("formatGrowthRate: 증감률은 반올림한 정수 %, 양수엔 +", () => {
  assert.equal(formatGrowthRate(150, 1, 100), "+50%");
  assert.equal(formatGrowthRate(100, 1, 100), "+0%");
  assert.equal(formatGrowthRate(50, 1, 100), "-50%");
  assert.equal(formatGrowthRate(10, 1, 3), "+233%");
  assert.equal(formatGrowthRate(0, 1, 3), "-100%");
});
