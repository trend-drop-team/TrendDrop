/** 한국 X 트렌드 목록만 1회 조회한다. 본문 검색·재시도·미러 폴백은 없다. */
import { FETCH_TIMEOUT_MS } from "./http.mjs";

export function parse(body) {
  if (body?.status !== "success" || !Array.isArray(body.trends) || !body.trends.length) {
    throw new Error("X 트렌드 API 응답 오류 또는 빈 목록");
  }
  const seen = new Set();
  return body.trends.slice(0, 50).map(({ trend }) => {
    if (typeof trend?.name !== "string" || !trend.name.trim() || !Number.isInteger(trend.rank) || trend.rank < 1) {
      throw new Error("X 트렌드 항목 형식 오류");
    }
    return { source: "xtrends", unit: "title", text: trend.name.trim(), meta: { rank: trend.rank, provider: "twitterapi.io" } };
  }).filter((item) => {
    if (seen.has(item.text)) return false;
    seen.add(item.text);
    return true;
  });
}

export async function collect() {
  const key = process.env.TWITTERAPI_IO_KEY;
  if (!key) throw new Error("TWITTERAPI_IO_KEY 미설정");
  const response = await fetch("https://api.twitterapi.io/twitter/trends?woeid=23424868&count=50", {
    headers: { "X-API-Key": key }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`X 트렌드 API HTTP ${response.status}`);
  return parse(await response.json());
}
