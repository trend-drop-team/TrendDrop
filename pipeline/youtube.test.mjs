import { test } from "node:test";
import assert from "node:assert/strict";
import { collect } from "./sources/youtube.mjs";

test("분야별 영상 수집은 중복을 제거하고 채널 맥락을 보존한다", async (context) => {
  context.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith("commentThreads")) return { json: async () => ({ items: [] }) };
    const category = url.searchParams.get("videoCategoryId") ?? "general";
    const video = (id) => ({ id, snippet: { title: id, channelTitle: "채널", channelId: "channel", categoryId: category }, statistics: {} });
    return { json: async () => ({ items: [video("shared"), video(category)] }) };
  });
  const previous = process.env.YOUTUBE_API_KEY;
  process.env.YOUTUBE_API_KEY = "test-key";
  try {
    const items = await collect();
    assert.equal(items.length, 6);
    assert.equal(items.filter((item) => item.meta.videoId === "shared").length, 1);
    assert.ok(items.every((item) => item.meta.channelId === "channel"));
  } finally {
    if (previous === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = previous;
  }
});
