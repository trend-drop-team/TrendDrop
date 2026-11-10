import ExploreView from "@/app/explore-view";
import SampleDataBadge from "@/app/sample-data-badge";
import StaleCacheWriter from "@/app/stale-cache-writer";
import { fetchApi } from "@/lib/api-client";
import type { ApiResult } from "@/types/api/common";
import type { HeatmapPayload } from "@/types/api/heatmap";
import type { TimelineSnapshot } from "@/types/api/trend";

/** 히트맵 가로축·A/B 비교 차트가 함께 보는 구간. */
const WINDOW_HOURS = 12;

// 빌드 타임 프리렌더 금지 — 프리렌더로 돌리면 빌드가 백엔드 가동 여부에 묶인다.
// 데이터 캐시는 fetchApi가 맡는다.
export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  const [heatmapResult, timelineResult] = await Promise.all([
    fetchApi<ApiResult<HeatmapPayload>>(`/api/explore/heatmap?window=${WINDOW_HOURS}h`),
    fetchApi<ApiResult<TimelineSnapshot[]>>("/api/trends/timeline"),
  ]);

  const { columns, categories, matrix } = heatmapResult.data;

  // 수집 run이 아직 없으면(운영에서 DB가 비어 있는 새 배포 등) 히트맵·비교를 그리지 않고 안내만 한다.
  // 운영은 mock으로 메우지 않으므로 이 화면이 그대로 보이는 게 의도된 동작이다(#87).
  if (categories.length === 0 || columns.length === 0) {
    return (
      <div className="page-shell">
        <main className="app-main">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">EXPLORE</p>
                <h3>아직 집계된 트렌드가 없습니다</h3>
              </div>
            </div>
            <div className="empty-state-box">
              <p>첫 수집이 끝나면 카테고리 히트맵과 키워드 비교가 표시됩니다.</p>
            </div>
          </section>
        </main>
      </div>
    );
  }

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
        <SampleDataBadge metas={[heatmapResult.meta, timelineResult.meta]} />
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
