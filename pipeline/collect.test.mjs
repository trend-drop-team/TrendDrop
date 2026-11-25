import { test } from "node:test";
import assert from "node:assert/strict";
// collect.mjs는 직접 실행할 때만 수집(main)을 돈다 — import만으로는 네트워크·DB를 건드리지 않는다
import { hourBucket, judgeCollection, shouldSkipSave, CollectFailedError, errorAnnotation } from "./collect.mjs";
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

test("커뮤니티를 제외하고 X·유튜브·RSS만 수집한다", () => {
  const names = ["dcbest", "theqoo", "instiz", "youtube", "gtrends", "xtrends"];
  const adapters = names.map((name) => [name, f]);
  assert.deepEqual(activeAdapters(adapters, EXCLUDED_SOURCES).map(([name]) => name), ["youtube", "gtrends", "xtrends"]);
});

// #84 — 소스 실패가 Actions에 드러나도록 판정한다
const ok = (name, n = 3) => ({ name, items: Array.from({ length: n }, (_, i) => ({ text: `${name}${i}` })) });
const failed = (name, error) => ({ name, items: [], error });

test("세 소스 모두 받으면 success, 실패 목록은 비어 있다", () => {
  assert.deepEqual(judgeCollection([ok("xtrends"), ok("youtube"), ok("gtrends")]), { status: "success", failures: [] });
});

test("하나라도 오류가 나면 partial이고 그 소스와 사유가 실패로 잡힌다", () => {
  const { status, failures } = judgeCollection([failed("xtrends", "HTTP 500"), ok("youtube"), ok("gtrends")]);
  assert.equal(status, "partial");
  assert.deepEqual(failures, [{ name: "xtrends", reason: "HTTP 500" }]);
});

test("오류 없이 0건이어도 실패로 본다", () => {
  const { status, failures } = judgeCollection([ok("xtrends"), ok("youtube", 0), ok("gtrends")]);
  assert.equal(status, "partial");
  assert.deepEqual(failures, [{ name: "youtube", reason: "0건" }]);
});

test("모두 실패하면 error", () => {
  const { status, failures } = judgeCollection([failed("xtrends", "timeout"), failed("youtube", "403"), ok("gtrends", 0)]);
  assert.equal(status, "error");
  assert.equal(failures.length, 3);
});

test("실패 오류는 소스명과 사유를 메시지에 담는다", () => {
  const err = new CollectFailedError([{ name: "xtrends", reason: "HTTP 500" }]);
  assert.ok(err instanceof Error);
  assert.match(err.message, /xtrends\(HTTP 500\)/);
});

test("DATABASE_URL이 있으면 저장한다", () => {
  assert.equal(shouldSkipSave({ DATABASE_URL: "postgres://x", GITHUB_ACTIONS: "true" }), false);
});

test("로컬에서 DATABASE_URL이 없으면 저장만 건너뛴다", () => {
  assert.equal(shouldSkipSave({}), true);
});

test("Actions에서 DATABASE_URL이 없으면 실패한다", () => {
  assert.throws(() => shouldSkipSave({ GITHUB_ACTIONS: "true" }), /DATABASE_URL/);
});

test("Actions에서 DATABASE_URL이 빈 문자열이어도 실패한다", () => {
  assert.throws(() => shouldSkipSave({ DATABASE_URL: "", GITHUB_ACTIONS: "true" }), /DATABASE_URL/);
});

test("::error 줄은 개행·%를 이스케이프해 한 줄로 남는다", () => {
  const line = errorAnnotation("xtrends", "HTTP 500\n::warning::가짜 100%");
  assert.equal(line, "::error title=collect xtrends 실패::HTTP 500%0A::warning::가짜 100%25");
  assert.equal(line.split("\n").length, 1);
});
