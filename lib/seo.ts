/**
 * 검색엔진 노출(SEO)용 구조화 데이터(JSON-LD)와 사이트 소유 확인 메타(#140).
 *
 * 키워드·요약은 외부에서 수집한 텍스트라, `<script type="application/ld+json">` 안에 넣을 때
 * `</script>`로 태그를 탈출하지 못하도록 serializeJsonLd로만 직렬화한다.
 */
import type { Metadata } from "next";

import type { KeywordDetail } from "@/types/api/keyword";
import type { TrendRow } from "@/types/api/trend";

import { SITE_DESCRIPTION, SITE_NAME } from "./site";

export type JsonLd = Record<string, unknown>;

/** 홈 ItemList에 싣는 상위 키워드 수 — 화면 첫 페이지와 같은 규모. */
export const ITEM_LIST_LIMIT = 10;

/** 상세 페이지 경로. 공유 버튼·사이트맵과 같은 인코딩을 쓴다. */
export function trendPath(slug: string): string {
  return `/trend/${encodeURIComponent(slug)}`;
}

/**
 * HTML `<script>` 본문에 넣어도 안전한 JSON 문자열.
 * `<`·`>`·`&`와 JS 줄 구분자(U+2028/2029)를 \u 이스케이프한다 — JSON으로는 같은 값이다.
 */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replaceAll(LINE_SEPARATOR, "\\u2028")
    .replaceAll(PARAGRAPH_SEPARATOR, "\\u2029");
}

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

/** 홈: 사이트 정체성(WebSite) — 검색 결과의 사이트 이름 표기에 쓰인다. */
export function websiteJsonLd(base: string): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: `${base}/`,
    description: SITE_DESCRIPTION,
    inLanguage: "ko-KR",
  };
}

/** 홈: 지금 순위(ItemList) — 각 항목은 상세 페이지로 이어진다. */
export function trendListJsonLd(base: string, rows: readonly TrendRow[]): JsonLd {
  const items = [...rows].sort((a, b) => a.rank - b.rank).slice(0, ITEM_LIST_LIMIT);
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "지금 뜨는 SNS 트렌드 순위",
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    numberOfItems: items.length,
    itemListElement: items.map((row, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: row.keyword,
      url: `${base}${trendPath(row.slug)}`,
    })),
  };
}

/**
 * 상세: 기사(Article) + 이동 경로(BreadcrumbList).
 * 수집 시각은 API가 "n분 전" 같은 상대 표기로만 주므로 datePublished는 넣지 않는다(지어내지 않음).
 */
export function trendDetailJsonLd(base: string, detail: KeywordDetail): JsonLd[] {
  const url = `${base}${trendPath(detail.slug)}`;
  const description = detail.summary.trim() || `${detail.keyword} — ${detail.category} 트렌드 ${detail.rank}위`;

  return [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: `${detail.keyword} — 왜 뜨나`,
      description,
      url,
      mainEntityOfPage: url,
      inLanguage: "ko-KR",
      articleSection: detail.category,
      keywords: [detail.keyword, ...detail.keywords].join(", "),
      publisher: { "@type": "Organization", name: SITE_NAME, url: `${base}/` },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME, item: `${base}/` },
        { "@type": "ListItem", position: 2, name: detail.keyword, item: url },
      ],
    },
  ];
}

/**
 * 구글 서치콘솔·네이버 서치어드바이저 소유 확인 메타.
 * 값은 각 콘솔이 주는 토큰이며, 설정된 것만 태그로 나간다(없으면 undefined → 태그 없음).
 */
export function searchVerification(
  env: Partial<Record<string, string | undefined>> = process.env,
): Metadata["verification"] {
  const google = env.GOOGLE_SITE_VERIFICATION?.trim();
  const naver = env.NAVER_SITE_VERIFICATION?.trim();
  if (!google && !naver) return undefined;

  return {
    ...(google ? { google } : {}),
    ...(naver ? { other: { "naver-site-verification": naver } } : {}),
  };
}
