import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { keywords, sources, trendContents, trendSnapshots } from "@/db/schema";
import { fetchGoogleTrendingKeywords } from "@/lib/google-trends";
import { searchGoogleNewsRss } from "@/lib/google-news-rss";
import { getYoutubeVideoStats, searchYoutubeVideos } from "@/lib/youtube-api";
import { hasYoutubeApiKey } from "@/lib/env";

function categoryFor(term: string) {
  if (/ai|앱|테크|스마트폰|챗gpt/i.test(term)) return "테크";
  if (/축구|야구|월드컵|선수|경기/i.test(term)) return "스포츠";
  if (/패션|뷰티|화장|메이크업|신발/i.test(term)) return "패션·뷰티";
  if (/맛집|음식|카페|레시피/i.test(term)) return "푸드";
  return "사회·문화";
}

export async function collectTrendPipeline({ geo = "KR", limit = 10 } = {}) {
  const db = getDb();
  const trendSource = await db.insert(sources).values({ name: "Google Trends", kind: "google-trends" })
    .onConflictDoUpdate({ target: sources.name, set: { kind: "google-trends" } }).returning();
  const youtubeSource = await db.insert(sources).values({ name: "YouTube Data API", kind: "youtube" })
    .onConflictDoUpdate({ target: sources.name, set: { kind: "youtube" } }).returning();
  const newsSource = await db.insert(sources).values({ name: "Google News RSS", kind: "google-news" })
    .onConflictDoUpdate({ target: sources.name, set: { kind: "google-news" } }).returning();
  const trends = await fetchGoogleTrendingKeywords({ geo, limit });
  const results = [];

  for (const [index, trend] of trends.entries()) {
    const category = categoryFor(trend.term);
    const [keyword] = await db.insert(keywords).values({ term: trend.term, category, sourceId: trendSource[0].id })
      .onConflictDoUpdate({ target: keywords.term, set: { category, sourceId: trendSource[0].id } }).returning();
    const news = await searchGoogleNewsRss(trend.term).catch(() => []);
    const videos = hasYoutubeApiKey() ? await searchYoutubeVideos(trend.term).catch(() => []) : [];
    const stats = hasYoutubeApiKey() ? await getYoutubeVideoStats(videos.map((item) => item.id.videoId).filter((id): id is string => Boolean(id))).catch(() => []) : [];

    await db.insert(trendSnapshots).values({
      keywordId: keyword.id,
      score: Math.max(1, 100 - index * 4),
      growthRate: trend.traffic ? `${trend.traffic.toLocaleString()} 검색` : "급상승",
      velocity: `${Math.max(4, 10 - index / 2).toFixed(1)}/10`,
      summary: news[0]?.title ?? `${trend.term} 관련 검색이 급증하고 있습니다.`,
      reason: `Google Trends 1차 선별 후 YouTube ${videos.length}건, Google News ${news.length}건을 확인했습니다.`,
      sourceLabel: "Google Trends → YouTube + Google News",
      externalRef: `google-trends:${geo}:${trend.term}`,
      sourceUrl: news[0]?.link ?? `https://trends.google.com/trending?geo=${geo}`,
    });

    for (const item of news.slice(0, 3)) {
      await db.insert(trendContents).values({ keywordId: keyword.id, kind: "news", title: item.title, url: item.link, source: item.source, publishedAt: item.publishedAt ? new Date(item.publishedAt) : null });
    }
    for (const [videoIndex, video] of videos.slice(0, 3).entries()) {
      const videoId = video.id.videoId;
      if (!videoId) continue;
      await db.insert(trendContents).values({ keywordId: keyword.id, kind: "youtube", title: video.snippet.title, url: `https://www.youtube.com/watch?v=${videoId}`, source: youtubeSource[0].name, rank: videoIndex + 1, publishedAt: new Date(video.snippet.publishedAt) });
    }
    results.push({ term: trend.term, news: news.length, youtube: videos.length, stats: stats.length });
  }
  return { geo, selected: trends.length, items: results };
}
