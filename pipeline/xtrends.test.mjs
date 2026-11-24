import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, collect } from "./sources/xtrends.mjs";

const body = { status: "success", trends: [{ trend: { name: "#새밈", rank: 1 } }, { trend: { name: "상품", rank: 2 } }] };
test("X 목록은 이름과 API 순위를 그대로 보존한다", () => {
  assert.deepEqual(parse(body).map((r) => [r.text, r.meta.rank]), [["#새밈", 1], ["상품", 2]]);
  assert.throws(() => parse({ status: "error" }), /오류/);
  assert.throws(() => parse({ status: "success", trends: [{ trend: { name: "a" } }] }), /형식/);
});
test("X는 목록 1회만 요청하며 실패해도 재시도하지 않는다", async (context) => {
  const previous = process.env.TWITTERAPI_IO_KEY;
  process.env.TWITTERAPI_IO_KEY = "test-key";
  context.after(() => { if (previous === undefined) delete process.env.TWITTERAPI_IO_KEY; else process.env.TWITTERAPI_IO_KEY = previous; });
  const calls = [];
  context.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push(String(url));
    assert.equal(options.headers["X-API-Key"], "test-key");
    return { ok: true, json: async () => body };
  });
  assert.equal((await collect()).length, 2);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]).searchParams.get("count"), "50");
  context.mock.method(globalThis, "fetch", async () => { calls.push("failure"); return { ok: false, status: 429 }; });
  await assert.rejects(collect(), /429/);
  assert.equal(calls.length, 2);
});
