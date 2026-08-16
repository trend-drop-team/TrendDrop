/**
 * Google Trends 한국 급상승 검색어 — 공식 RSS. (뉴스/대중화 신호 / trend-collector 이전)
 * meta에 rank·approxTraffic·newsTitles 를 담아 둔다(나중에 뜻 설명 등에 활용 가능).
 */
import { clean, fetchText } from "./http.mjs";

const RSS_URL = "https://trends.google.com/trending/rss?geo=KR";

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? clean(m[1]) : undefined;
}

function extractAll(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const out = [];
  let m;
  while ((m = re.exec(block)) !== null) {
    const t = clean(m[1]);
    if (t) out.push(t);
  }
  return out;
}

export async function collect() {
  const xml = await fetchText(RSS_URL);
  const out = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  let rank = 0;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const keyword = extractTag(block, "title");
    if (!keyword) continue;
    rank += 1;
    out.push({
      source: "gtrends",
      unit: "title",
      text: keyword,
      meta: {
        rank,
        approxTraffic: extractTag(block, "ht:approx_traffic") ?? "-",
        newsTitles: extractAll(block, "ht:news_item_title"),
      },
    });
  }
  return out;
}
