import { test } from "node:test";
import assert from "node:assert/strict";
import { rankPopular } from "./popular.mjs";

const T1 = "2026-10-20T10:00:00.000Z";
const T2 = "2026-10-20T11:00:00.000Z";
const termsOf = (row) => row.terms ?? [];
const row = (o) => ({ meta: null, terms: ["A"], ...o });
const find = (res, term) => res.ranked.find((r) => r.term === term);

test("같은 영상·같은 시간대의 제목+댓글 반복은 1번만 센다", () => {
  const rows = [
    row({ site: "youtube", kind: "title", text: "t", videoId: "v1", bucketAt: T1 }),
    ...[1, 2, 3].map((i) =>
      row({ site: "youtube", kind: "comment", text: `c${i}`, videoId: "v1", bucketAt: T1 })),
  ];
  const a = find(rankPopular(rows, { termsOf, minMentions: 1 }), "A");
  assert.equal(a.mentions, 1);
  assert.equal(a.rawScore, 6);
});

test("같은 영상이 두 시간대에 있어도 mentions 1", () => {
  const rows = [T1, T2].map((bucketAt) =>
    row({ site: "youtube", kind: "title", text: "t", videoId: "v1", bucketAt }));
  const a = find(rankPopular(rows, { termsOf, minMentions: 1 }), "A");
  assert.equal(a.mentions, 1);
});

test("다른 영상 2개가 같은 키워드를 내면 mentions 2", () => {
  const rows = ["v1", "v2"].map((videoId) =>
    row({ site: "youtube", kind: "title", text: videoId, videoId, bucketAt: T1 }));
  const a = find(rankPopular(rows, { termsOf }), "A");
  assert.equal(a.mentions, 2);
});

test("dcbest 같은 textHash가 두 시간대에 있으면 mentions 1, deduped 1", () => {
  const rows = [T1, T2].map((bucketAt) =>
    row({ site: "dcbest", kind: "title", text: "same", textHash: "h1", bucketAt }));
  const res = rankPopular(rows, { termsOf, minMentions: 1 });
  assert.equal(find(res, "A").mentions, 1);
  assert.equal(res.meta.deduped, 1);
  assert.equal(res.meta.rows, 2);
});

test("dcbest 다른 글 2개면 mentions 2", () => {
  const rows = ["h1", "h2"].map((textHash) =>
    row({ site: "dcbest", kind: "title", text: textHash, textHash, bucketAt: T1 }));
  const res = rankPopular(rows, { termsOf });
  assert.equal(find(res, "A").mentions, 2);
  assert.equal(res.meta.deduped, 0);
});

test("gtrends 행 1개의 rawScore는 8", () => {
  const rows = [row({ site: "gtrends", kind: "title", text: "q", bucketAt: T1 })];
  assert.equal(find(rankPopular(rows, { termsOf }), "A").rawScore, 8);
});

test("다른 소스의 같은 text·textHash는 합치지 않는다 (mentions 2, breadth 2)", () => {
  const rows = ["gtrends", "dcbest"].map((site) =>
    row({ site, kind: "title", text: "X", textHash: "hx", bucketAt: T1 }));
  const a = find(rankPopular(rows, { termsOf }), "A");
  assert.equal(a.mentions, 2);
  assert.equal(a.breadth, 2);
});

test("gtrends 같은 textHash는 최신 meta로 계산한다 (입력 순서 무관)", () => {
  const old = row({ site: "gtrends", kind: "title", text: "q", textHash: "hq", bucketAt: T1, meta: { approxTraffic: "100+" } });
  const next = row({ site: "gtrends", kind: "title", text: "q", textHash: "hq", bucketAt: T2, meta: { approxTraffic: "10000+" } });
  const fwd = find(rankPopular([old, next], { termsOf }), "A").rawScore;
  const rev = find(rankPopular([next, old], { termsOf }), "A").rawScore;
  assert.ok(fwd > 8);
  assert.equal(rev, fwd);
});

test("meta.deduped는 가중치 있는 행 수 - 고유 항목 수", () => {
  const two = ["h1", "h2"].map((textHash) =>
    row({ site: "dcbest", kind: "title", text: textHash, textHash, bucketAt: T1 }));
  assert.equal(rankPopular(two, { termsOf }).meta.deduped, 0);
  const T3 = "2026-10-20T12:00:00.000Z";
  const three = [T1, T2, T3].map((bucketAt) =>
    row({ site: "dcbest", kind: "title", text: "same", textHash: "h1", bucketAt }));
  assert.equal(rankPopular(three, { termsOf, minMentions: 1 }).meta.deduped, 2);
});

test("다른 영상의 똑같은 댓글은 따로 센다 (mentions 2)", () => {
  const rows = ["v1", "v2"].map((videoId) =>
    row({ site: "youtube", kind: "comment", text: "A 최고", textHash: "hc", videoId, bucketAt: T1 }));
  const res = rankPopular(rows, { termsOf });
  assert.equal(find(res, "A").mentions, 2);
  assert.equal(res.meta.deduped, 0);
});

test("같은 영상의 댓글 행이 제목 행보다 먼저 와도 제목 점수(6)를 쓴다", () => {
  const comment = row({ site: "youtube", kind: "comment", text: "A 최고", textHash: "hc", videoId: "v1", bucketAt: T1 });
  const title = row({ site: "youtube", kind: "title", text: "A MV", textHash: "ht", videoId: "v1", bucketAt: T1 });
  const res = rankPopular([comment, title], { termsOf, minMentions: 1 });
  assert.equal(find(res, "A").rawScore, 6);
  assert.equal(find(res, "A").mentions, 1);
});

test("termMultiplier는 키워드별로 곱해지고, 안 넘기면 ×1", () => {
  const rows = [row({ site: "dcbest", kind: "title", text: "x", textHash: "h1", bucketAt: T1, terms: ["A", "B"] })];
  const res = rankPopular(rows, { termsOf, minMentions: 1, termMultiplier: (t) => (t === "A" ? 2 : 1) });
  assert.equal(find(res, "A").rawScore, 8);
  assert.equal(find(res, "B").rawScore, 4);
  const plain = rankPopular(rows, { termsOf, minMentions: 1 });
  assert.equal(find(plain, "A").rawScore, 4);
  assert.equal(find(plain, "B").rawScore, 4);
});
