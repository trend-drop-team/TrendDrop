// Google AdSense 설정. 값이 없으면 광고 관련 코드는 아무것도 렌더하지 않는다(#117).
// NEXT_PUBLIC_* 는 빌드 때 인라인되므로 서버·클라이언트 첫 렌더가 항상 같다.

const CLIENT_PATTERN = /^ca-pub-\d{10,20}$/;

export const ADSENSE_CLIENT = (process.env.NEXT_PUBLIC_ADSENSE_CLIENT ?? "").trim();
export const ADSENSE_SLOT_FEED = (process.env.NEXT_PUBLIC_ADSENSE_SLOT_FEED ?? "").trim();
export const ADSENSE_SLOT_DETAIL = (process.env.NEXT_PUBLIC_ADSENSE_SLOT_DETAIL ?? "").trim();

export function isAdsenseClientValid(client: string): boolean {
  return CLIENT_PATTERN.test(client);
}

/**
 * 광고 스크립트를 실제로 불러도 되는 환경인가 — 운영 빌드에서만(로컬·Vercel 프리뷰 제외).
 * VERCEL_ENV는 서버 전용이므로 서버 컴포넌트(layout)에서만 호출한다.
 */
export function adsEnabledOnServer(): boolean {
  return (
    isAdsenseClientValid(ADSENSE_CLIENT) &&
    process.env.NODE_ENV === "production" &&
    process.env.VERCEL_ENV !== "preview"
  );
}

/** 개발 중에만 쓰는 슬롯 자리표시자 미리보기 — NEXT_PUBLIC_ADSENSE_PREVIEW=1. 운영에선 무시된다. */
export function adsPreviewOnServer(): boolean {
  return (
    isAdsenseClientValid(ADSENSE_CLIENT) &&
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_ADSENSE_PREVIEW === "1"
  );
}
