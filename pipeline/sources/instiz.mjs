/**
 * 인스티즈 메인 전체 인기글 top10. HTML 스크래핑. (10~20대 여성)
 *
 * 예전에는 /pt(익명 잡담판)를 긁었는데 "지하철 마스크 써야겠더라" 같은 신변잡기라
 * 트렌드 키워드가 거의 안 나왔다. 메인의 전체 인기글로 바꾸니 세븐틴·올리브영·
 * 통영 살인사건처럼 실제 이슈가 잡힌다.
 *
 * 구조: #boardhot > .realchart_item.rank_item_N
 *         <span class="itsme rank">N</span>
 *         <span class="minitext">카테고리</span>
 *         <span class="post_title">제목</span>   ← 아이콘 태그가 섞여 있어 제거 필요
 */
import { clean, fetchText } from "./http.mjs";

const URL = "https://www.instiz.net/";
const SECTION = 'id="boardhot"'; // 이 뒤가 인기글 목록. 앞쪽 메뉴/스크립트와 섞이지 않게 자른다
const LIMIT = 10;

// rank_item_N ~ post_title 까지. 사이에 아이콘·링크가 끼어 있어 넉넉히 건너뛴다.
const ITEM_RE =
  /rank_item_(\d+)"[\s\S]{0,400}?<span class="minitext">([^<]*)<\/span>[\s\S]{0,120}?<span class="post_title">([\s\S]*?)<\/span>/g;

export async function collect() {
  const html = await fetchText(URL, URL);
  const idx = html.indexOf(SECTION);
  const body = idx >= 0 ? html.slice(idx) : html;

  const out = [];
  let m;
  ITEM_RE.lastIndex = 0;
  while ((m = ITEM_RE.exec(body)) !== null && out.length < LIMIT) {
    // post_title 안에 <i class="fa-..."> 아이콘이 들어 있다 → 태그 제거 후 정리
    const text = clean(m[3].replace(/<[^>]*>/g, " "));
    if (!text) continue;
    const category = clean(m[2]) || undefined;
    out.push({
      source: "instiz",
      unit: "title",
      text,
      meta: { rank: Number(m[1]), ...(category ? { category } : {}) },
    });
  }
  return out;
}
