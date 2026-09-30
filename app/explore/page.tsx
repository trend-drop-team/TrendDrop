import ExploreView from "@/app/explore-view";
import StaleCacheWriter from "@/app/stale-cache-writer";
import { fetchApi } from "@/lib/api-client";
import type { ApiResult } from "@/types/api/common";
import type { HeatmapPayload } from "@/types/api/heatmap";
import type { TimelineSnapshot } from "@/types/api/trend";

/** 히트맵 가로축·A/B 비교 차트가 함께 보는 구간. */
const WINDOW_HOURS = 12;

export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  const [heatmapResult, timelineResult] = await Promise.all([
    fetchApi<ApiResult<HeatmapPayload>>(`/api/explore/heatmap?window=${WINDOW_HOURS}h`),
    fetchApi<ApiResult<TimelineSnapshot[]>>("/api/trends/timeline"),
  ]);

  const { columns, categories, matrix } = heatmapResult.data;

  // A/B 옵션 = 최신 시점의 랭킹 키워드
  const keywords = (timelineResult.data.at(-1)?.rows ?? []).map((row) => ({
    keyword: row.keyword,
    slug: row.slug,
    category: row.category,
    rank: row.rank,
  }));

  const staleSummary = {
    heading: "마지막으로 확인된 키워드",
    items: keywords.slice(0, 5).map((item) => ({
      primary: item.keyword,
      secondary: item.category,
      trailing: `${item.rank}위`,
    })),
  };

  return (
    <div className="page-shell">
      <main className="app-main">
        <StaleCacheWriter cacheKey="explore" summary={staleSummary} />
        <ExploreView
          columns={columns}
          categories={categories}
          matrix={matrix}
          keywords={keywords}
          windowHours={WINDOW_HOURS}
        />
      </main>
    </div>
  );
}
