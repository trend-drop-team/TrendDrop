/**
 * 소스 어댑터 공통 HTTP/HTML 유틸. trend-collector src/sources/types.ts 에서 이전.
 * 각 어댑터는 collect() → [{ source, unit, text, meta? }] 를 반환한다.
 */
export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * 소스 요청 공통 타임아웃. 응답이 늦는 경우를 감안해 넉넉히 둔다(#85).
 * 현재 활성 소스(X·유튜브·RSS)는 요청 1회씩 병렬이라 워크플로 20분 안에 든다.
 * 페이지를 순차로 여러 번 받는 소스(dcbest 등)를 다시 켜면 합계 시간을 다시 계산할 것.
 */
export const FETCH_TIMEOUT_MS = 120_000;

/** 최소 HTML 엔티티 디코딩. */
export function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** 태그 제거 + 엔티티 디코딩 + 공백 정리. */
export function clean(raw) {
  return decodeEntities(raw.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** UA/Referer를 달아 텍스트를 받는다. 실패·타임아웃 시 예외. */
export async function fetchText(url, referer, { timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const headers = { "User-Agent": BROWSER_UA };
  if (referer) headers["Referer"] = referer;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}\n${body.slice(0, 200)}`);
  }
  return body;
}
