import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "./sources/xtrends.mjs";

const GDT = `
<ol>
<tr><td class="main"><a href="/korea/trend/%23HASH">#축하의_바람이_분다</a></td></tr>
<tr><td class="main"><a class="string" href="/korea/trend/%EB%A7%88%EB%A3%A8">마루 생일</a></td></tr>
<tr><td class="main"><a class="string" href="/korea/trend/HAPPY_K_DAY">#HAPPY_K_DAY</a></td></tr>
<tr><td class="main"><a class="string" href="/korea/trend/a" title="x">AT&amp;T 먼작귀</a></td></tr>
<tr><td class="main"><a class="string" href="/korea/trend/dup">마루 생일</a></td></tr>
<a class="string" href="/korea/trend/side">순위표 밖 링크</a>
</ol>`;

const T24 = `
<div class=list-container><h3 class=title>now</h3><ol class=trend-card__list>
<li><span class=trend-name><a href="https://twitter.com/search?q=%EB%8B%A8%EC%B2%B4%EB%B2%84%EB%B8%94" class=trend-link>단체버블</a><span class=tweet-count></span></span></li>
<li><span class=trend-name><a href="https://x.com/search?q=%EB%A7%8C%EB%A3%A8" class=trend-link>만루홈런</a></span></li>
</ol></div>
<div class=list-container><h3 class=title>1 hour ago</h3><ol class=trend-card__list>
<li><a href="https://twitter.com/search?q=%EB%A6%AC%EC%BF%A0">리쿠</a></li>
</ol></div>`;

test("getdaytrends: 순서·rank·mirror·중복 제거·엔티티", () => {
  const r = parse(GDT, "getdaytrends");
  assert.deepEqual(r.map((x) => x.text), ["#축하의_바람이_분다", "마루 생일", "#HAPPY_K_DAY", "AT&T 먼작귀"]); // 해시태그(class 없음) 포함, 순위표 밖 링크 제외
  assert.deepEqual(r.map((x) => x.meta.rank), [1, 2, 3, 4]);
  assert.ok(r.every((x) => x.meta.mirror === "getdaytrends" && x.source === "xtrends" && x.unit === "title"));
});

test("trends24: 첫 카드만, 둘째 카드 미포함", () => {
  const r = parse(T24, "trends24");
  assert.deepEqual(r.map((x) => x.text), ["단체버블", "만루홈런"]);
  assert.deepEqual(r.map((x) => x.meta), [{ rank: 1, mirror: "trends24" }, { rank: 2, mirror: "trends24" }]);
});

test("빈 HTML은 빈 배열, 모르는 미러는 예외", () => {
  assert.deepEqual(parse("<html></html>", "trends24"), []);
  assert.throws(() => parse("", "nope"), /미러/);
});
