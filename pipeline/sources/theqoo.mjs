/** 더쿠 핫게시판 제목. HTML 스크래핑. (여초 팬덤 / trend-collector 이전) */
import { clean, fetchText } from "./http.mjs";

const URL = "https://theqoo.net/hot";
const NOTICE_DIVIDER = "모든 공지 확인하기"; // 이 뒤가 실제 글 목록
const ITEM_RE = /<td class="title">\s*<a href="\/hot\/\d+">([^<]+)<\/a>/g;

export async function collect() {
  const html = await fetchText(URL, "https://theqoo.net/");
  const idx = html.indexOf(NOTICE_DIVIDER);
  const body = idx >= 0 ? html.slice(idx + NOTICE_DIVIDER.length) : html;

  const out = [];
  let m;
  ITEM_RE.lastIndex = 0;
  while ((m = ITEM_RE.exec(body)) !== null) {
    const text = clean(m[1]);
    if (text) out.push({ source: "theqoo", unit: "title", text });
  }
  return out;
}
