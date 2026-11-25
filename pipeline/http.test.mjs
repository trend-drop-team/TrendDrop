import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchText } from "./sources/http.mjs";

// 응답이 오지 않는 서버를 흉내 낸다 — abort 신호가 와야만 끝난다.
function hangingFetch(t) {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = (_url, { signal } = {}) => new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason));
  });
}

test("응답이 없으면 타임아웃으로 실패해 수집이 멈춰 있지 않는다 (#85)", async (t) => {
  hangingFetch(t);
  // AbortSignal.timeout 타이머는 unref라 이벤트 루프를 붙잡지 않는다 — 테스트 동안만 붙잡아 둔다.
  const keepAlive = setTimeout(() => {}, 5_000);
  t.after(() => clearTimeout(keepAlive));
  await assert.rejects(fetchText("https://example.test/rss", undefined, { timeoutMs: 30 }), { name: "TimeoutError" });
});
