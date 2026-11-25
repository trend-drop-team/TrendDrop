import { test } from "node:test";
import assert from "node:assert/strict";
import { collect } from "./sources/youtube.mjs";

test("유튜브는 전체 인기 20개를 1회 요청하고 댓글·분야는 요청하지 않는다", async (context) => {
  const previous = process.env.YOUTUBE_API_KEY;
  process.env.YOUTUBE_API_KEY = "test-key";
  context.after(() => { if (previous === undefined) delete process.env.YOUTUBE_API_KEY; else process.env.YOUTUBE_API_KEY = previous; });
  let calls = 0;
  context.mock.method(globalThis, "fetch", async (input) => {
    calls++;
    const url = new URL(input);
    assert.ok(url.pathname.endsWith("/videos"));
    assert.equal(url.searchParams.get("maxResults"), "20");
    assert.equal(url.searchParams.has("videoCategoryId"), false);
    return { ok: true, json: async () => ({ items: [{ id: "v", snippet: { title: "제목", channelId: "channel" }, statistics: {} }] }) };
  });
  const items = await collect();
  assert.equal(calls, 1);
  assert.equal(items.length, 1);
  assert.equal(items[0].unit, "title");
  assert.equal(items[0].meta.channelId, "channel");
});

test("키가 없으면 0건으로 숨기지 않고 사유와 함께 실패한다 (#84)", async (context) => {
  const previous = process.env.YOUTUBE_API_KEY;
  delete process.env.YOUTUBE_API_KEY;
  context.after(() => { if (previous !== undefined) process.env.YOUTUBE_API_KEY = previous; });
  context.mock.method(globalThis, "fetch", async () => { throw new Error("호출되면 안 됨"); });
  await assert.rejects(collect(), /YOUTUBE_API_KEY 미설정/);
});
