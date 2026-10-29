/**
 * 디시인사이드 실시간 베스트(실베) 제목. HTML 스크래핑. (trend-collector 이전)
 * 2026-10-21: 1페이지(50개)로는 6시간 창에 글 2개 이상 키워드가 모자라 3페이지(최대 150개)로 늘렸다.
 */
import { clean, fetchText } from "./http.mjs";
import { EXCLUDED_GALLERIES } from "./dcbest-galleries.mjs"; // 뉴스 갤러리 제외 목록 (근거는 그 파일)

export { EXCLUDED_GALLERIES };

const URL = "https://gall.dcinside.com/board/lists/?id=dcbest";
const PAGES = 3; // 1~PAGES 페이지를 순서대로 받는다
const PAGE_DELAY_MS = 300; // 페이지 요청 사이 대기
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

/** 여러 페이지의 항목을 한 배열로 합친다. text가 같으면 먼저 나온 것만 남긴다. */
export function mergePages(pages) {
  const seen = new Set();
  const out = [];
  for (const page of pages) {
    for (const item of page) {
      if (seen.has(item.text)) continue;
      seen.add(item.text);
      out.push(item);
    }
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 첫 페이지 실패는 그대로 throw, 이후 페이지 실패는 그때까지 모은 것을 돌려준다. */
export async function collect() {
  const pages = [];
  for (let n = 1; n <= PAGES; n++) {
    try {
      if (n > 1) await sleep(PAGE_DELAY_MS);
      const url = n === 1 ? URL : `${URL}&page=${n}`;
      pages.push(parse(await fetchText(url, "https://www.dcinside.com/")));
    } catch (e) {
      if (n === 1) throw e; // 아무것도 못 긁은 것
      console.warn(`dcbest ${n}페이지 실패, ${n - 1}페이지까지만 쓴다: ${String(e.message).slice(0, 80)}`);
      break;
    }
  }
  return mergePages(pages);
}
