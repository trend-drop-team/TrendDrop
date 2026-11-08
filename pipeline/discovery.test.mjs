import { test } from "node:test";
import assert from "node:assert/strict";
import { rankDiscovery, diversifyDiscovery } from "./discovery.mjs";

const row = (term, identity, hour, site = "dcbest") => ({ text: term, textHash: identity, site, bucketAt: `2026-11-04T${hour}:00:00Z`, meta: { rank: 3 } });
const candidate = (term, score = 20, mentions = 2) => ({ term, score, mentions });
const termsOf = (item) => [item.text];
const info = (term) => ({ category: term === "유명인" ? "인물" : "유행어·밈" });

test("다양성은 빈 분야를 강제하지 않고 비슷한 점수의 다른 분야를 우선한다", () => {
  const items = [candidate("게임1", 100), candidate("게임2", 95), candidate("음식", 90)];
  const domains = new Map([["게임1", "gaming"], ["게임2", "gaming"], ["음식", "food"]]);
  assert.deepEqual(diversifyDiscovery(items, domains, 3).map((item) => item.term), ["게임1", "음식", "게임2"]);
  assert.equal(items[1].score, 95);
  assert.ok(diversifyDiscovery(items, domains).every((item) => item.score >= 0 && item.score <= 100));
  assert.equal(diversifyDiscovery(items.slice(0, 2), domains, 10).length, 2);
});

test("같은 글의 재수집은 새로운 확산으로 세지 않는다", () => {
  const rows = [row("장기유행", "old", "06"), row("장기유행", "old2", "07"), row("장기유행", "old", "12"), row("새유행", "new1", "11"), row("새유행", "new2", "12")];
  const ranked = rankDiscovery([candidate("장기유행", 100), candidate("새유행", 10)], rows, termsOf, info);
  assert.equal(ranked[0].term, "새유행");
  assert.equal(ranked.find((item) => item.term === "장기유행").discovery.newMentions, 0);
});

test("단일 검색어는 상위 트렌드가 여러 버킷에서 확인될 때만 허용한다", () => {
  const rows = [row("새유행", "same", "11", "xtrends"), row("새유행", "same", "12", "xtrends")];
  assert.equal(rankDiscovery([candidate("새유행", 10, 1)], rows, termsOf, info).length, 1);
  assert.equal(rankDiscovery([candidate("새유행", 10, 1)], rows.slice(1), termsOf, info).length, 0);
  assert.equal(rankDiscovery([candidate("유명인", 10, 1)], rows.map((item) => ({ ...item, text: "유명인" })), termsOf, info).length, 0);
});

test("새 수집 분야는 비교 이력 없이 급상승이라고 판단하지 않는다", () => {
  const rows = [row("새유행", "one", "11"), row("새유행", "two", "12")];
  const [result] = rankDiscovery([candidate("새유행")], rows, termsOf, info);
  assert.equal(result.discovery.momentum, null);
  assert.equal(result.discovery.comparable, false);
});

test("같은 채널의 여러 영상만으로는 확산 근거를 충족하지 않는다", () => {
  const rows = [row("새유행", "one", "11", "youtube"), row("새유행", "two", "12", "youtube")]
    .map((item) => ({ ...item, videoId: item.textHash, meta: { channelId: "same-channel" } }));
  assert.equal(rankDiscovery([candidate("새유행")], rows, termsOf, info).length, 0);
  rows[1].meta.channelId = "another-channel";
  assert.equal(rankDiscovery([candidate("새유행")], rows, termsOf, info).length, 1);
});

test("뒤늦게 채널 ID가 수집돼도 같은 영상은 출처 하나다", () => {
  const rows = [
    { ...row("새유행", "one", "06", "youtube"), videoId: "same-video", meta: {} },
    { ...row("새유행", "one", "12", "youtube"), videoId: "same-video", meta: { channelId: "channel" } },
  ];
  assert.equal(rankDiscovery([candidate("새유행")], rows, termsOf, info).length, 0);
});

test("단일 영상은 최근 공개 조회수와 조회속도 근거가 있을 때만 허용한다", () => {
  const rows = [{ ...row("새유행", "video", "12", "youtube"), kind: "title", videoId: "video", meta: {
    channelId: "channel", viewCount: 120000, publishedAt: "2026-11-04T06:00:00Z",
  } }];
  const [result] = rankDiscovery([candidate("새유행", 10, 1)], rows, termsOf, info);
  assert.equal(result.discovery.audienceEvidence, true);
  rows[0].meta.viewCount = 1000;
  assert.equal(rankDiscovery([candidate("새유행", 10, 1)], rows, termsOf, info).length, 0);
});
