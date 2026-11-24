import { test } from "node:test";
import assert from "node:assert/strict";
import { generateJsonWithRetry } from "./gemini.mjs";

function mockApi(context, responses) {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  context.after(() => { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous; });
  const calls = [];
  context.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, body: options.body });
    const response = responses[calls.length - 1];
    if (response instanceof Error) throw response;
    const status = response ?? 200;
    return new Response(JSON.stringify(status === 200
      ? { candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"ok":true}' }] } }] }
      : { error: { message: "temporary" } }), { status });
  });
  return calls;
}
const args = ["model", "system", "input", { type: "OBJECT" }];

test("성공 응답은 대기·추가 요청 없이 반환한다", async (context) => {
  const calls = mockApi(context, [200]);
  const waits = [];
  assert.deepEqual(await generateJsonWithRetry(...args, { wait: async (ms) => waits.push(ms) }), { ok: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(waits, []);
});
for (const status of [500, 502, 503, 504]) {
  test(`${status} 뒤 성공하면 5초 대기 후 동일 요청을 1회 재전송한다`, async (context) => {
    const calls = mockApi(context, [status, 200]);
    const waits = [];
    assert.deepEqual(await generateJsonWithRetry(...args, { wait: async (ms) => waits.push(ms) }), { ok: true });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], calls[1]);
    assert.deepEqual(waits, [5000]);
  });
}
for (const status of [400, 401, 403, 404, 429]) {
  test(`${status}는 재시도하지 않는다`, async (context) => {
    const calls = mockApi(context, [status, 200]);
    const waits = [];
    await assert.rejects(generateJsonWithRetry(...args, { wait: async (ms) => waits.push(ms) }), (error) => error.status === status);
    assert.equal(calls.length, 1);
    assert.deepEqual(waits, []);
  });
}
test("503이 계속 나도 총 2회에서 멈추고 실패를 전달한다", async (context) => {
  const calls = mockApi(context, [503, 503, 200]);
  await assert.rejects(generateJsonWithRetry(...args, { wait: async () => {} }), (error) => error.status === 503);
  assert.equal(calls.length, 2);
});
test("타임아웃도 1회만 재시도한다", async (context) => {
  const calls = mockApi(context, [new DOMException("timed out", "TimeoutError"), 200]);
  assert.deepEqual(await generateJsonWithRetry(...args, { wait: async () => {} }), { ok: true });
  assert.equal(calls.length, 2);
});
test("응답 JSON 파싱 오류는 재시도하지 않는다", async (context) => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => { calls++; return new Response('not-json', { status: 200 }); });
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  context.after(() => { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous; });
  await assert.rejects(generateJsonWithRetry(...args, { wait: async () => {} }));
  assert.equal(calls, 1);
});
