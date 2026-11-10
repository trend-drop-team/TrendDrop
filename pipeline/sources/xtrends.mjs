/**
 * X(트위터) 한국 실시간 트렌드 — 공개 미러 사이트 스크래핑. (2026-10-21 추가)
 *
 * 서비스 목적(유행어·신조어·장소·화제의 콘텐츠)에 가장 가까운 신호가 X 트렌드인데,
 * 공식 API는 유료다. 대신 로그인 없이 한국 트렌드 40~60개를 보여주는 미러 두 곳을 쓴다.
 *   1순위 getdaytrends.com/korea/  — 순위표 셀 <td class="main"><a href="/korea/trend/...">…</a> 가 순위 순으로 나온다
 *            (일반 트렌드는 <a class="string" …>, 해시태그는 class 없이 <a href=…> — 2026-10-21 실측 27+43개)
 *   2순위 trends24.in/korea/       — 첫 trend-card(가장 최신 시각) 안의 twitter.com/search 링크 목록
 * 제3자 미러라 언제든 마크업이 바뀌거나 막힐 수 있다 — 하나가 실패하면 다음 미러를 시도하고,
 * 둘 다 실패하면 빈 배열이 아니라 throw 한다(collect.mjs가 소스별 오류로 보고).
 * 우리는 사이트 소유자가 아니므로 스크래핑은 매시간 1회(cron)로 제한한다.
 */
import { clean, fetchText } from "./http.mjs";

export const MIRRORS = [
  { name: "getdaytrends", url: "https://getdaytrends.com/korea/", referer: "https://getdaytrends.com/" },
  { name: "trends24", url: "https://trends24.in/korea/", referer: "https://trends24.in/" },
];

const MAX_ITEMS = 50;

const GETDAYTRENDS_RE = /<td class="main">\s*<a(?:\s+class="[^"]*")?\s+href="\/korea\/trend\/[^"]*"[^>]*>([^<]+)<\/a>/g;
// trends24는 속성에 따옴표가 없다(<ol class=trend-card__list>). 첫 <ol>이 가장 최신 시각의 목록 (2026-10-21 실측)
const TRENDS24_CARD_RE = /<ol[^>]*trend-card__list[^>]*>([\s\S]*?)<\/ol>/;
const TRENDS24_ITEM_RE = /<a\s+href="https:\/\/(?:twitter|x)\.com\/search\?q=[^"]*"[^>]*>([^<]+)<\/a>/g;

/** re의 첫 캡처 그룹을 모두 모아 clean → 빈 문자열·중복 제외 → 최대 50개. */
function extract(block, re) {
  const seen = new Set();
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(block)) !== null && out.length < MAX_ITEMS) {
    const text = clean(m[1]);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

/** 미러 HTML → 항목(순수 함수). mirror는 MIRRORS의 name. 알 수 없는 미러는 예외. */
export function parse(html, mirror) {
  let texts;
  if (mirror === "getdaytrends") {
    texts = extract(html, GETDAYTRENDS_RE);
  } else if (mirror === "trends24") {
    const card = html.match(TRENDS24_CARD_RE); // 첫 목록 = 가장 최신 시각
    texts = card ? extract(card[1], TRENDS24_ITEM_RE) : [];
  } else {
    throw new Error(`알 수 없는 X 트렌드 미러: ${mirror}`);
  }
  return texts.map((text, i) => ({
    source: "xtrends",
    unit: "title",
    text,
    meta: { rank: i + 1, mirror },
  }));
}

export async function collect() {
  const failures = [];
  for (const m of MIRRORS) {
    try {
      const items = parse(await fetchText(m.url, m.referer), m.name);
      if (items.length > 0) return items;
      failures.push(`${m.name}: 항목 0개(마크업 변경 의심)`);
    } catch (err) {
      failures.push(`${m.name}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    }
  }
  throw new Error(`X 트렌드 미러 모두 실패 — ${failures.join("; ")}`);
}
