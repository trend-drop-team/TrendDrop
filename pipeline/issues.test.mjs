import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORY_MULT, termMultiplierFor, cleanItem } from "./issues.mjs";
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
