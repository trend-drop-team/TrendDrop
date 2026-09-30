/**
 * OG 이미지용 한글 폰트 로더.
 *
 * `next/og`(satori)의 기본 폰트에는 한글 글리프가 없어 한글이 전부 □로 깨진다.
 * Noto Sans KR 전체는 수 MB라 번들에 넣을 수 없으므로 Google Fonts의 `text=`
 * 서브셋 API로 "이 카드에 실제로 쓰이는 글자"만 잘라 받는다(보통 20KB 안팎).
 *
 * 폰트를 못 받아도 카드 자체는 떠야 하므로 실패는 빈 배열로 흡수한다.
 * 다만 그 빈 배열을 ImageResponse에 그대로 넘기면 안 된다 — `ogFontOption()` 참고.
 */

export const OG_FONT_FAMILY = "Noto Sans KR";

export type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 700;
  style: "normal";
};

const WEIGHTS = [400, 700] as const;

/**
 * Google Fonts는 User-Agent로 포맷을 고른다. 최신 UA면 woff2(satori가 못 읽음),
 * MSIE 8이면 EOT(역시 못 읽음)를 준다. `Mozilla/4.0`이 truetype을 주는 조합이다.
 */
const TTF_UA = "Mozilla/4.0";
/** format() 표기는 UA에 따라 붙기도 빠지기도 해서, URL만 잡고 포맷은 바이트로 확인한다. */
const SRC_URL = /src:\s*url\((https:\/\/[^)]+)\)/;

/** satori가 읽는 컨테이너의 매직 넘버 — TTF / OTTO / true / ttcf / wOFF. woff2는 제외. */
const SUPPORTED_MAGIC = new Set(["00010000", "4f54544f", "74727565", "74746366", "774f4646"]);

/** 같은 글자 조합이면 서브셋도 같다 — 인스턴스가 살아 있는 동안 재사용한다. */
const cache = new Map<string, OgFont[]>();

/** 카드에 그릴 문자열들에서 실제 쓰인 글자만 모아 서브셋 키를 만든다. */
function subsetKey(parts: string[]): string {
  return [...new Set(parts.join(""))].sort().join("");
}

function isSupportedFont(data: ArrayBuffer): boolean {
  if (data.byteLength < 4) return false;
  const head = [...new Uint8Array(data.slice(0, 4))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return SUPPORTED_MAGIC.has(head);
}

async function fetchWeight(chars: string, weight: 400 | 700): Promise<OgFont | null> {
  const css = await fetch(
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(OG_FONT_FAMILY)}` +
      `:wght@${weight}&text=${encodeURIComponent(chars)}`,
    { headers: { "User-Agent": TTF_UA } },
  );
  if (!css.ok) return null;

  const match = SRC_URL.exec(await css.text());
  if (!match) return null;

  const file = await fetch(match[1]);
  if (!file.ok) return null;

  const data = await file.arrayBuffer();
  if (!isSupportedFont(data)) return null;

  return { name: OG_FONT_FAMILY, data, weight, style: "normal" };
}

/**
 * 카드에 쓰이는 문자열들을 넘기면 그 글자만 담은 Noto Sans KR 400/700을 돌려준다.
 * 한 글자도 못 받으면 빈 배열.
 */
export async function loadOgFonts(parts: string[]): Promise<OgFont[]> {
  const chars = subsetKey(parts);
  if (!chars) return [];

  const cached = cache.get(chars);
  if (cached) return cached;

  try {
    // 한 번에 두 굵기를 요청하면 Google이 하나만 내려주므로 굵기별로 받는다.
    const loaded = await Promise.all(WEIGHTS.map((weight) => fetchWeight(chars, weight)));
    const fonts = loaded.filter((font): font is OgFont => font !== null);
    if (fonts.length > 0) cache.set(chars, fonts);
    return fonts;
  } catch {
    return [];
  }
}

/**
 * ImageResponse 옵션 조각.
 *
 * 빈 배열을 `fonts`로 넘기면 satori가 내장 기본 폰트까지 잃고
 * "No fonts are loaded"로 렌더 전체가 죽는다. 못 받았으면 키 자체를 빼야
 * 기본 폰트로라도(=한글만 빠진 채) 카드가 뜬다.
 */
export function ogFontOption(fonts: OgFont[]): { fonts?: OgFont[] } {
  return fonts.length > 0 ? { fonts } : {};
}
