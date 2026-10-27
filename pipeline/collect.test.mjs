import { test } from "node:test";
import assert from "node:assert/strict";
import { activeAdapters } from "./adapters.mjs";
import { EXCLUDED_SOURCES } from "./sources/excluded-sources.mjs";

const f = () => [];
const g = () => [];

test("제외 목록의 소스는 실행 목록에서 빠진다", () => {
  assert.deepEqual(activeAdapters([["dcbest", f], ["theqoo", g]], ["theqoo"]), [["dcbest", f]]);
});

test("제외 목록이 비면 전부 실행한다 (되돌리기)", () => {
  const all = [["dcbest", f], ["theqoo", g]];
  assert.deepEqual(activeAdapters(all, []), all);
});

test("입력 배열을 바꾸지 않는다", () => {
  const all = [["dcbest", f], ["theqoo", g]];
  activeAdapters(all, ["theqoo"]);
  assert.equal(all.length, 2);
});

test("EXCLUDED_SOURCES는 더쿠·인스티즈다", () => {
  assert.deepEqual(EXCLUDED_SOURCES, ["theqoo", "instiz"]);
});
