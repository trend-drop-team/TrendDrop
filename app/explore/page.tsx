import ExploreView from "@/app/explore-view";
import { getHeatmap, getTimeline } from "@/lib/api/service";

/** 히트맵 가로축·A/B 비교 차트가 함께 보는 구간. */
const WINDOW_HOURS = 12;

export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  const [heatmapResult, timelineResult] = await Promise.all([
    getHeatmap(WINDOW_HOURS),
    getTimeline(),
  ]);

  const { columns, categories, matrix } = heatmapResult.data;

  // A/B 옵션 = 최신 시점의 랭킹 키워드
  const keywords = (timelineResult.data.at(-1)?.rows ?? []).map((row) => ({
    keyword: row.keyword,
    slug: row.slug,
    category: row.category,
    rank: row.rank,
  }));

  return (
    <div className="page-shell">
      <main className="app-main">
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