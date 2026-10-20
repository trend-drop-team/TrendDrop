/** 디시인사이드 실시간 베스트(실베) 제목. HTML 스크래핑. (trend-collector 이전) */
import { clean, fetchText } from "./http.mjs";
import { EXCLUDED_GALLERIES } from "./dcbest-galleries.mjs"; // 뉴스 갤러리 제외 목록 (근거는 그 파일)

export { EXCLUDED_GALLERIES };

const URL = "https://gall.dcinside.com/board/lists/?id=dcbest";
const ITEM_RE =
  /<a\s+href="\/board\/view\/\?id=dcbest[^"]*"\s+view-msg\s*=""[^>]*>([\s\S]*?)<\/a>/g;

/** 제목 앞의 [XX갤] 출처 태그를 뽑아 meta로. */
function galleryTag(title) {
  const m = title.match(/^\s*\[([^\]]+)\]/);
  return m ? m[1] : undefined;
}

/** 실베 목록 HTML → 항목. 제외 갤러리 글은 건너뛴다. */
export function parse(html) {
  const out = [];
  let m;
  ITEM_RE.lastIndex = 0;
  while ((m = ITEM_RE.exec(html)) !== null) {
    const text = clean(m[1]);
    if (!text || /^\d+$/.test(text)) continue;
    if (text.includes("갤러리 이용 안내")) continue; // 공지 스킵
    const gallery = galleryTag(text);
    if (gallery && EXCLUDED_GALLERIES.includes(gallery)) continue; // 뉴스 갤러리 제외
    out.push({ source: "dcbest", unit: "title", text, meta: gallery ? { gallery } : undefined });
  }
  return out;
}

export async function collect() {
  return parse(await fetchText(URL, "https://www.dcinside.com/"));
}
