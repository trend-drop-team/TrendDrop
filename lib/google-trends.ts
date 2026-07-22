const GOOGLE_TRENDS_RSS_URL = "https://trends.google.com/trending/rss";
const GOOGLE_TRENDS_TIMEOUT_MS = 15_000;

export type GoogleTrendKeyword = {
  term: string;
  traffic: number | null;
  startedAt: string | null;
  relatedQueries: string[];
};

function decodeXml(value: string) {
  return value
    .replaceAll("<![CDATA[", "")
    .replaceAll("]]>", "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .trim();
}

function tagValue(xml: string, name: string) {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

export async function fetchGoogleTrendingKeywords({
  geo = "KR",
  limit = 20,
}: { geo?: string; limit?: number } = {}) {
  const params = new URLSearchParams({ geo, hl: "ko", ceid: `${geo}:ko` });
  const response = await fetch(`${GOOGLE_TRENDS_RSS_URL}?${params.toString()}`, {
    headers: { Accept: "application/rss+xml, application/xml, text/xml" },
    cache: "no-store",
    signal: AbortSignal.timeout(GOOGLE_TRENDS_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Google Trends RSS request failed (${response.status})`);
  }

  const xml = await response.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];

  return items.slice(0, limit).map((item) => ({
    term: tagValue(item, "title"),
    traffic: Number(tagValue(item, "ht:approx_traffic").replaceAll(",", "")) || null,
    startedAt: tagValue(item, "pubDate") || null,
    relatedQueries: (item.match(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/gi) ?? [])
      .map((query) => decodeXml(query.replace(/<\/?ht:news_item_title>/gi, "")))
      .filter(Boolean),
  }));
}
