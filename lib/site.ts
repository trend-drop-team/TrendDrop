/**
 * 공유 링크·OG 태그·공유 카드가 함께 쓰는 서비스 정체성.
 *
 * 스토어 없이 웹앱으로 나가므로 카드에 박힌 주소가 유일한 재방문 단서다(이슈 #51).
 * 그래서 주소는 env 하나(`NEXT_PUBLIC_SITE_URL`)로만 정하고, 카드·메타태그가 같은 값을 본다.
 */

export const SITE_NAME = "TrendDrop";
export const SITE_TITLE = "TrendDrop — 지금 뜨는 SNS 트렌드";
export const SITE_DESCRIPTION =
  "실시간으로 오르내리는 SNS 트렌드를 순위·상승률·근거까지 한 화면에서 봅니다.";

/** 프론트가 서비스되는 절대 주소. 끝 슬래시는 항상 떼서 돌려준다. */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (configured) return configured;
  // Vercel 프리뷰 배포는 도메인이 매번 달라져 env로 못 박는다.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/** 카드 하단에 찍는, 사람이 읽는 주소(스킴·www 없이). */
export function siteDomain(): string {
  return siteUrl().replace(/^https?:\/\//, "").replace(/^www\./, "");
}
