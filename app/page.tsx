import Onboarding from "@/app/onboarding";
import RankingBoard from "@/app/ranking-board";
import { getCategories, getTimeline, getTrends } from "@/lib/api/service";
import CollectionControls from "@/components/collection-controls";

/** 랭킹 밖에서 올라오고 있는 "예비" 키워드로 볼 상위 컷. */
const WATCH_FROM_RANK = 10;
const WATCH_LIMIT = 4;

// 수집 run이 계속 쌓이므로 홈은 매 요청마다 새로 그린다.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [categoryResult, timelineResult, dailyResult] = await Promise.all([
    getCategories(),
    getTimeline(),
    getTrends({ period: "daily" }),
  ]);

  const categories = categoryResult.data.map((category) => category.name);
  const snapshots = timelineResult.data;
  const latest = snapshots.at(-1);

  // 워치리스트 API(3.6)는 로그인한 user_id가 있어야 하므로, 로그인이 붙기 전까지
  // 이 패널은 "상위권 바로 아래에서 올라오는 키워드"를 최신 run에서 뽑아 보여준다.
  const upcoming = (latest?.rows ?? [])
    .filter((row) => row.rank > WATCH_FROM_RANK)
    .slice(0, WATCH_LIMIT);

  return (
    <div className="page-shell">
      <main className="app-main">
        <Onboarding categories={categories} />

        <RankingBoard snapshots={snapshots} daily={dailyResult.data} categories={categories} />

        <CollectionControls />

        {upcoming.length > 0 && (
          <section className="panel watchlist-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">WATCHLIST</p>
                <h3>예비 급상승 키워드</h3>
              </div>
            </div>
            <ul className="watchlist">
              {upcoming.map((item) => (
                <li key={item.slug}>
                  <div className="watch-keyword">
                    <strong>{item.keyword}</strong>
                    <p className="watch-meta">
                      {item.category} · {item.rank}위 · {item.growth}
                    </p>
                  </div>
                  <span className="watch-score">{item.score}/100</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}