import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORY_MULT, TIMELINESS_MULT, termMultiplierFor, cleanItem, rankIssues } from "./issues.mjs";
import { ISSUE_CATEGORIES } from "./issue-prompt.mjs";

const extractions = new Map([
  ["h1", { timeliness: "now", keywords: [
    { name: "엔믹스", category: "인물", issue: null },
    { name: "긴 소원", category: "작품·콘텐츠", issue: null },
  ] }],
  // 같은 이름에 글마다 다른 카테고리 — 두쫀쿠는 유행어·밈 2표, 기업·주식 1표
  ["h2", { timeliness: "buzz", keywords: [{ name: "두쫀쿠", category: "유행어·밈", issue: null }] }],
  ["h3", { timeliness: "buzz", keywords: [{ name: "두쫀쿠", category: "유행어·밈", issue: null }] }],
  ["h4", { timeliness: "now", keywords: [{ name: "두쫀쿠", category: "기업·주식", issue: null }] }],
]);
const aliases = new Map([["엔믹스", "NMIXX"]]);
const mult = termMultiplierFor(extractions, aliases);

test("별칭으로 합쳐진 이름도 원래 키워드의 카테고리 계수를 받는다", () => {
  assert.equal(mult("NMIXX", { textHash: "h1" }), 0.8);
  assert.equal(mult("긴 소원", { textHash: "h1" }), 1.5);
});

test("같은 이름에 카테고리가 갈리면 가장 많이 붙은 것(대표 카테고리) 하나로 곱한다", () => {
  assert.equal(mult("두쫀쿠", { textHash: "h4" }), 2.0); // 기업·주식으로 붙은 글에서도 유행어·밈 계수
});

test("창 안에 없는 이름은 ×1", () => {
  assert.equal(mult("모르는 이름", { textHash: "h1" }), 1);
});

test("CATEGORY_MULT 키는 ISSUE_CATEGORIES와 정확히 같다", () => {
  assert.deepEqual([...Object.keys(CATEGORY_MULT)].sort(), [...ISSUE_CATEGORIES].sort());
});


test("xtrends 줄은 키워드를 1개까지만 남기고 해시태그의 표기를 다듬은 이름을 받아들인다", () => {
  const r = cleanItem(
    {
      id: 1,
      timeliness: "now",
      keywords: [
        { name: "축하의 바람이 분다", surface: "#축하의_바람이_분다", category: "유행어·밈", issue: null },
        { name: "다른것", surface: "다른것", category: "인물", issue: null },
      ],
    },
    { site: "xtrends", text: "#축하의_바람이_분다" },
  );
  assert.equal(r.keywords.length, 1);
  assert.equal(r.keywords[0].name, "축하의 바람이 분다");
});

test("xtrends: 줄에 없는 이름과 1글자 조각은 버린다", () => {
  const row = { site: "xtrends", text: "마루 생일" };
  const r = cleanItem({ id: 1, timeliness: "buzz", keywords: [
    { name: "마", surface: "마", category: "인물", issue: null },
    { name: "리쿠", surface: "리쿠", category: "인물", issue: null },
    { name: "마루", surface: "마루", category: "인물", issue: null },
  ] }, row);
  assert.deepEqual(r.keywords.map((k) => k.name), ["마루"]);
  assert.equal(r.rejected, 2);
});

/* ── 카테고리 계수·시의성 배율이 최종 점수에 들어가는지 (#89) ─────────── */

test("CATEGORY_MULT 값 고정 (2026-10-20 B안)", () => {
  assert.deepEqual(CATEGORY_MULT, {
    "유행어·밈": 2.0,
    "작품·콘텐츠": 1.5,
    "사건·사고": 1.0,
    "재난·속보": 1.0,
    "인물": 0.8,
    "기업·주식": 0.6,
    "스포츠": 0.6,
    "정치·사회": 0.5,
  });
  assert.deepEqual(TIMELINESS_MULT, { now: 1.0, buzz: 0.7, evergreen: 0.3 });
});

test("rankIssues(검수 없음): 점수 = 소스 가중치 × 시의성 × 카테고리 계수 (× 교차 보너스)", async () => {
  const T = "2026-10-20T10:00:00.000Z";
  const rows = [
    { site: "dcbest", kind: "title", text: "두쫀쿠 먹어봄", textHash: "d1", bucketAt: T },
    { site: "dcbest", kind: "title", text: "두쫀쿠 품절", textHash: "d2", bucketAt: T },
    { site: "gtrends", kind: "title", text: "홍길동", textHash: "g1", bucketAt: T },
    { site: "gtrends", kind: "title", text: "옛날 영화", textHash: "g2", bucketAt: T },
  ];
  const ext = new Map([
    ["d1", { timeliness: "buzz", keywords: [{ name: "두쫀쿠", category: "유행어·밈", issue: null }] }],
    ["d2", { timeliness: "now", keywords: [{ name: "두쫀쿠", category: "유행어·밈", issue: null }] }],
    ["g1", { timeliness: "now", keywords: [{ name: "홍길동", category: "인물", issue: null }] }],
    ["g2", { timeliness: "evergreen", keywords: [{ name: "옛날 영화", category: "작품·콘텐츠", issue: null }] }],
  ]);
  const { ranked } = await rankIssues(rows, ext, new Map(), { useReview: false });
  const by = Object.fromEntries(ranked.map((k) => [k.term, k]));
  assert.ok(Math.abs(by["두쫀쿠"].rawScore - (4 * 0.7 * 2 + 4 * 1.0 * 2)) < 1e-9); // 13.6
  assert.ok(Math.abs(by["홍길동"].rawScore - 8 * 1.0 * 0.8) < 1e-9); // 6.4
  assert.ok(Math.abs(by["옛날 영화"].rawScore - 8 * 0.3 * 1.5) < 1e-9); // 3.6
  assert.deepEqual(ranked.map((k) => k.term), ["두쫀쿠", "홍길동", "옛날 영화"]);
  assert.equal(by["두쫀쿠"].category, "유행어·밈");
});
