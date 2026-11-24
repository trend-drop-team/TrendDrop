import { test } from "node:test";
import assert from "node:assert/strict";
import { withRoleModels } from "./gemini.mjs";
for (const status of [429, 500, 502, 503, 504]) {
  test(`${status}는 같은 모델을 반복하지 않고 다음 모델로 넘어간다`, async () => {
    const tried = [];
    const result = await withRoleModels(["a", "b", "c"], async (model) => {
      tried.push(model);
      if (model === "a") throw Object.assign(new Error("temporary"), { status });
      return "answer";
    });
    assert.deepEqual(tried, ["a", "b"]);
    assert.deepEqual(result, { result: "answer", model: "b" });
  });
}
for (const status of [400, 401, 403, 404]) {
  test(`${status}는 모델 전환을 하지 않는다`, async () => {
    const tried = [];
    await assert.rejects(withRoleModels(["a", "b"], async (model) => {
      tried.push(model); throw Object.assign(new Error("invalid"), { status });
    }), (error) => error.status === status);
    assert.deepEqual(tried, ["a"]);
  });
}
test("응답 오류와 실행 전체 호출 상한 오류도 전환하지 않는다", async () => {
  let calls = 0;
  await assert.rejects(withRoleModels(["a", "b"], async () => { calls++; throw new SyntaxError("invalid response"); }));
  assert.equal(calls, 1);
});
test("타임아웃은 다음 모델로 넘어가고 전부 실패하면 마지막 오류를 보존한다", async () => {
  const tried = [];
  await assert.rejects(withRoleModels(["a", "b"], async (model) => {
    tried.push(model); throw new DOMException("timeout", "TimeoutError");
  }), (error) => error.name === "TimeoutError");
  assert.deepEqual(tried, ["a", "b"]);
});
