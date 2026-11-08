import { test } from "node:test";
import assert from "node:assert/strict";
// collect.mjs는 직접 실행할 때만 수집(main)을 돈다 — import만으로는 네트워크·DB를 건드리지 않는다
import { hourBucket } from "./collect.mjs";
import { activeAdapters } from "./adapters.mjs";
import { EXCLUDED_SOURCES } from "./sources/excluded-sources.mjs";

test("hourBucket: 분·초·밀리초를 버린 UTC ISO", () => {
  assert.equal(hourBucket(new Date("2026-10-20T10:45:30.123Z")), "2026-10-20T10:00:00.000Z");
  assert.equal(hourBucket("2026-10-20T10:00:00.000Z"), "2026-10-20T10:00:00.000Z");
  assert.equal(hourBucket(Date.parse("2026-10-20T23:59:59.999Z")), "2026-10-20T23:00:00.000Z");
});

test("hourBucket: 입력 Date를 바꾸지 않는다", () => {
  const d = new Date("2026-10-20T10:45:30.000Z");
  hourBucket(d);
  assert.equal(d.toISOString(), "2026-10-20T10:45:30.000Z");
});

// 주의: hourBucket은 로컬 시간 setMinutes를 써서, 정시 단위가 아닌 시간대(예: TZ=Asia/Kolkata +05:30)에선
// 10:45Z → 10:30Z가 된다. 위 테스트도 그런 TZ에선 실패한다. Actions(UTC)·KST에선 문제없어
// 로직은 고치지 않고 기록만 한다(#89 보고).


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
