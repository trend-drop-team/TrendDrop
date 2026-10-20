import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, EXCLUDED_GALLERIES } from "./sources/dcbest.mjs";

const link = (no, title) =>
  `<a href="/board/view/?id=dcbest&no=${no}" view-msg ="">${title}</a>`;

test("뉴스 갤러리(더갤·잡갤) 글은 건너뛰고 싱갤 글만 남는다", () => {
  const html = [
    link(1, "[싱갤] 싱글벙글 제목"),
    link(2, "[더갤] [단독] 뉴스 제목"),
    link(3, "[잡갤] 기사식 제목…"),
  ].join("\n");
  const out = parse(html);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "[싱갤] 싱글벙글 제목");
  assert.equal(out[0].meta.gallery, "싱갤");
});

test("갤러리 태그 없는 글은 그대로 들어온다", () => {
  const out = parse(link(4, "태그 없는 제목"));
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "태그 없는 제목");
  assert.equal(out[0].meta, undefined);
});

test("EXCLUDED_GALLERIES에 6개가 모두 들어 있다", () => {
  assert.deepEqual([...EXCLUDED_GALLERIES].sort(), ["국갤", "군갤", "더갤", "새갤", "잡갤", "중갤"]);
});
