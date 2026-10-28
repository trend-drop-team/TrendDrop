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

/* ── 교차 보너스·최소 언급·정렬 (#89) ─────────────────────────────── */

test("소스 2곳 이상이면 교차 보너스 ×1.6, score는 반올림, rawScore는 보너스 전", () => {
  const rows = [
    row({ site: "dcbest", kind: "title", text: "d", textHash: "h1", bucketAt: T1 }),
    row({ site: "theqoo", kind: "title", text: "t", textHash: "h2", bucketAt: T1 }),
  ];
  const a = find(rankPopular(rows, { termsOf }), "A");
  assert.equal(a.rawScore, 8);
  assert.equal(a.score, Math.round(8 * 1.6));
  assert.equal(a.breadth, 2);
  assert.equal(a.crossed, true);
});

test("같은 소스 글 2개는 교차 보너스 없음", () => {
  const rows = ["h1", "h2"].map((textHash) =>
    row({ site: "dcbest", kind: "title", text: textHash, textHash, bucketAt: T1 }));
  const a = find(rankPopular(rows, { termsOf }), "A");
  assert.equal(a.score, 8);
  assert.equal(a.crossed, false);
});

test("options.crossBonus로 보너스 배율을 바꿀 수 있다", () => {
  const rows = [
    row({ site: "dcbest", kind: "title", text: "d", textHash: "h1", bucketAt: T1 }),
    row({ site: "instiz", kind: "title", text: "i", textHash: "h2", bucketAt: T1 }),
  ];
  assert.equal(find(rankPopular(rows, { termsOf, crossBonus: 2 }), "A").score, 16);
});

test("sources는 소스별 가중합 내림차순", () => {
  const rows = [
    row({ site: "dcbest", kind: "title", text: "d", textHash: "h1", bucketAt: T1 }),
    row({ site: "gtrends", kind: "title", text: "g", textHash: "h2", bucketAt: T1 }),
  ];
  const a = find(rankPopular(rows, { termsOf }), "A");
  assert.deepEqual(a.sources, [{ source: "gtrends", weightSum: 8 }, { source: "dcbest", weightSum: 4 }]);
});

test("커뮤니티 글 1개뿐인 키워드는 minMentions(2)에 걸려 빠진다", () => {
  const rows = [row({ site: "dcbest", kind: "title", text: "d", textHash: "h1", bucketAt: T1 })];
  const res = rankPopular(rows, { termsOf });
  assert.equal(find(res, "A"), undefined);
  assert.equal(res.meta.candidates, 1);
  assert.equal(res.meta.passed, 0);
});

test("gtrends·xtrends는 1개여도 통과한다 (keepSources)", () => {
  for (const site of ["gtrends", "xtrends"]) {
    const rows = [row({ site, kind: "title", text: "q", textHash: "h1", bucketAt: T1 })];
    const a = find(rankPopular(rows, { termsOf }), "A");
    assert.ok(a, site);
    assert.equal(a.rawScore, 8);
  }
});

test("score 내림차순, 같으면 mentions 내림차순, limit만큼 자른다", () => {
  const rows = [
    // A: gtrends 1개 = 8점, mentions 1
    row({ site: "gtrends", kind: "title", text: "g", textHash: "g1", bucketAt: T1, terms: ["A"] }),
    // B: dcbest 2개 = 8점, mentions 2 → 동점이면 B가 앞
    row({ site: "dcbest", kind: "title", text: "b1", textHash: "b1", bucketAt: T1, terms: ["B"] }),
    row({ site: "dcbest", kind: "title", text: "b2", textHash: "b2", bucketAt: T1, terms: ["B"] }),
    // C: dcbest 3개 = 12점
    ...["c1", "c2", "c3"].map((h) => row({ site: "dcbest", kind: "title", text: h, textHash: h, bucketAt: T1, terms: ["C"] })),
  ];
  const all = rankPopular(rows, { termsOf });
  assert.deepEqual(all.ranked.map((r) => r.term), ["C", "B", "A"]);
  const top2 = rankPopular(rows, { termsOf, limit: 2 });
  assert.deepEqual(top2.ranked.map((r) => r.term), ["C", "B"]);
  assert.equal(top2.meta.passed, 3); // passed는 limit 전 개수
});

test("rowMultiplier는 행 가중치에 곱해진다 (시의성 배율 자리)", () => {
  const rows = ["h1", "h2"].map((textHash) =>
    row({ site: "dcbest", kind: "title", text: textHash, textHash, bucketAt: T1 }));
  const a = find(rankPopular(rows, { termsOf, rowMultiplier: () => 0.5 }), "A");
  assert.equal(a.rawScore, 4);
});

test("가중치 없는 site|kind는 건너뛰고 meta.skipped에 센다, 가중치 0은 조용히 뺀다", () => {
  const rows = [
    row({ site: "natepann", kind: "title", text: "n", textHash: "n1", bucketAt: T1 }),
    row({ site: "natepann", kind: "title", text: "n2", textHash: "n2", bucketAt: T1 }),
    row({ site: "dcbest", kind: "title", text: "d", textHash: "d1", bucketAt: T1 }),
    row({ site: "gtrends", kind: "title", text: "g", textHash: "g1", bucketAt: T1 }),
  ];
  const res = rankPopular(rows, { termsOf, weights: { "dcbest|title": 0 } });
  assert.deepEqual(res.meta.skipped, [{ key: "natepann|title", n: 2 }]);
  const a = find(res, "A");
  assert.equal(a.rawScore, 8); // gtrends만
  assert.equal(a.breadth, 1);
});

test("한 글에 같은 키워드가 두 번 나와도 1번만 센다", () => {
  const rows = [row({ site: "gtrends", kind: "title", text: "g", textHash: "g1", bucketAt: T1, terms: ["A", "A"] })];
  assert.equal(find(rankPopular(rows, { termsOf }), "A").mentions, 1);
});

test("빈 입력·termsOf 누락은 throw", () => {
  assert.throws(() => rankPopular([], { termsOf }), /빈 입력/);
  assert.throws(() => rankPopular([row({ site: "dcbest", kind: "title", text: "x", bucketAt: T1 })]), /termsOf/);
});

/* ── 급상승 점수 risingScore (#89) ───────────────────────────────────
 * recent   = 최신 버킷 - 1시간 이후(포함)
 * baseline = 최신 - windowHours ~ recent 직전
 * risingScore = clamp(recent / max(baseline/기준선 버킷 수 + 1, 1) × 50, 0, 100) 반올림
 */
const H = (h) => `2026-10-20T${String(h).padStart(2, "0")}:00:00.000Z`;
const dc = (term, hash, h) =>
  row({ site: "dcbest", kind: "title", text: hash, textHash: hash, bucketAt: H(h), terms: [term] });

test("risingScore: 기준선 없이 최근에만 2번 → 100, 1번 → 50", () => {
  const rows = [dc("A", "a1", 12), dc("A", "a2", 12), dc("B", "b1", 12)];
  const res = rankPopular(rows, { termsOf, minMentions: 1 });
  assert.equal(find(res, "A").risingScore, 100);
  assert.equal(find(res, "A").recentMentions, 2);
  assert.equal(find(res, "A").baselineMentions, 0);
  assert.equal(find(res, "B").risingScore, 50);
});

test("risingScore: 기준선 버킷 1개에 2번, 최근 1번 → 1/(2+1)×50 = 17", () => {
  const rows = [dc("A", "a1", 8), dc("A", "a2", 8), dc("A", "a3", 12)];
  const a = find(rankPopular(rows, { termsOf }), "A");
  assert.equal(a.baselineMentions, 2);
  assert.equal(a.recentMentions, 1);
  assert.equal(a.risingScore, 17);
});

test("risingScore: 기준선은 키워드가 나온 버킷 수로 평균낸다 (2버킷에 2번 → 평균 1)", () => {
  const rows = [dc("A", "a1", 8), dc("A", "a2", 9), dc("A", "a3", 12)];
  const res = rankPopular(rows, { termsOf });
  assert.equal(find(res, "A").risingScore, 25); // 1 / (1 + 1) × 50
  assert.equal(res.meta.baselineBuckets, 2);
});

test("risingScore: 기준선에만 있고 최근엔 없으면 0", () => {
  const rows = [dc("A", "a1", 8), dc("A", "a2", 9), dc("B", "b1", 12)];
  assert.equal(find(rankPopular(rows, { termsOf }), "A").risingScore, 0);
});

test("risingScore: windowHours보다 오래된 행은 기준선에 넣지 않는다", () => {
  // 최신 12시, windowHours 2 → 기준선 시작 10시. 5시 행은 점수엔 들어가지만 기준선엔 안 들어간다
  const rows = [dc("A", "a1", 5), dc("A", "a2", 5), dc("A", "a3", 12)];
  const res = rankPopular(rows, { termsOf, windowHours: 2 });
  const a = find(res, "A");
  assert.equal(a.mentions, 3);
  assert.equal(a.baselineMentions, 0);
  assert.equal(a.risingScore, 50);
  assert.equal(res.meta.baselineBuckets, 0);
});

test("risingScore: 최신 버킷 기준이라 입력 순서와 무관", () => {
  const rows = [dc("A", "a3", 12), dc("A", "a1", 8), dc("A", "a2", 8)];
  assert.equal(find(rankPopular(rows, { termsOf }), "A").risingScore, 17);
});

test("risingScore: 같은 글이 기준선과 최근 버킷에 다 있으면 최신(최근) 하나로만 센다", () => {
  const rows = [dc("A", "same", 8), dc("A", "same", 12)];
  const a = find(rankPopular(rows, { termsOf, minMentions: 1 }), "A");
  assert.equal(a.recentMentions, 1);
  assert.equal(a.baselineMentions, 0);
  assert.equal(a.risingScore, 50);
});
