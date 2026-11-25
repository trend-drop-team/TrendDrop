import assert from "node:assert/strict";
import { test } from "node:test";

import type { KeywordDetail } from "@/types/api/keyword";
import type { TrendRow } from "@/types/api/trend";

import {
  ITEM_LIST_LIMIT,
  searchVerification,
  serializeJsonLd,
  trendDetailJsonLd,
  trendListJsonLd,
  trendPath,
} from "./seo";

const BASE = "https://trenddrop.example";

function row(rank: number, keyword: string, slug = keyword): TrendRow {
  return {
    rank,
    keyword,
    slug,
    category: "연예",
    previousRank: null,
    growth: "+10%",
    velocity: "",
    score: 50,
    risingScore: 50,
    source: "x",
    summary: "",
    reason: "",
    spark: [],
  };
}

function detail(overrides: Partial<KeywordDetail> = {}): KeywordDetail {
  return {
    rank: 3,
    keyword: "리제 오하",
    slug: "리제-오하",
    category: "연예",
    growth: "+120%",
    velocity: "",
    score: 77,
    detectedAgo: "10분 전",
    updatedAgo: "1분 전",
    summary: "신곡 공개로 언급이 급증했다.",
    reasons: [],
    series: [],
    days: [],
    related: [],
    keywords: ["신곡"],
    channels: [],
    timeline: [],
    ...overrides,
  };
}

test("serializeJsonLd: 수집 텍스트의 </script>가 태그를 탈출하지 못한다", () => {
  const out = serializeJsonLd({ name: "</script><script>alert(1)</script> &  " });
  assert.equal(out.includes("<"), false);
  assert.equal(out.includes(">"), false);
  assert.equal(out.includes("&"), false);
  assert.equal(out.includes(" "), false);
  // 이스케이프는 JSON으로는 같은 값이다.
  assert.deepEqual(JSON.parse(out), { name: "</script><script>alert(1)</script> &  " });
});

test("trendPath: 한글·특수문자 slug를 사이트맵과 같은 방식으로 인코딩", () => {
  assert.equal(trendPath("a b/c"), "/trend/a%20b%2Fc");
});

test("trendListJsonLd: 순위순 상위 N개만, 위치는 1부터, URL은 상세로", () => {
  const rows = Array.from({ length: ITEM_LIST_LIMIT + 5 }, (_, i) => row(ITEM_LIST_LIMIT + 5 - i, `k${i}`));
  const list = trendListJsonLd(BASE, rows) as { numberOfItems: number; itemListElement: { position: number; name: string; url: string }[] };

  assert.equal(list.numberOfItems, ITEM_LIST_LIMIT);
  assert.equal(list.itemListElement.length, ITEM_LIST_LIMIT);
  assert.equal(list.itemListElement[0].position, 1);
  assert.equal(list.itemListElement[0].name, `k${ITEM_LIST_LIMIT + 4}`); // rank 1
  assert.equal(list.itemListElement[0].url, `${BASE}/trend/k${ITEM_LIST_LIMIT + 4}`);
});

test("trendListJsonLd: 입력 배열을 바꾸지 않는다", () => {
  const rows = [row(2, "b"), row(1, "a")];
  trendListJsonLd(BASE, rows);
  assert.deepEqual(rows.map((r) => r.rank), [2, 1]);
});

test("trendDetailJsonLd: Article + BreadcrumbList, 요약이 비면 사실로 대체", () => {
  const [article, crumbs] = trendDetailJsonLd(BASE, detail()) as [Record<string, unknown>, { itemListElement: { item: string }[] }];
  assert.equal(article["@type"], "Article");
  assert.equal(article.url, `${BASE}/trend/${encodeURIComponent("리제-오하")}`);
  assert.equal(article.description, "신곡 공개로 언급이 급증했다.");
  assert.equal(article.keywords, "리제 오하, 신곡");
  assert.equal("datePublished" in article, false);
  assert.deepEqual(crumbs.itemListElement.map((c) => c.item), [`${BASE}/`, article.url]);

  const [fallback] = trendDetailJsonLd(BASE, detail({ summary: "  " })) as [Record<string, unknown>];
  assert.equal(fallback.description, "리제 오하 — 연예 트렌드 3위");
});

test("searchVerification: 설정된 토큰만 메타로 내보내고, 없으면 undefined", () => {
  assert.equal(searchVerification({}), undefined);
  assert.equal(searchVerification({ GOOGLE_SITE_VERIFICATION: "  " }), undefined);
  assert.deepEqual(searchVerification({ GOOGLE_SITE_VERIFICATION: "g1" }), { google: "g1" });
  assert.deepEqual(searchVerification({ NAVER_SITE_VERIFICATION: "n1" }), {
    other: { "naver-site-verification": "n1" },
  });
});
