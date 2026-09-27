import Onboarding from "@/app/onboarding";
import RankingBoard from "@/app/ranking-board";
import { fetchApi } from "@/lib/api-client";
import type { ApiResult } from "@/types/api/common";
import type { CategoryRow } from "@/types/api/category";
import type { TimelineSnapshot, TrendRow } from "@/types/api/trend";

/** 랭킹 밖에서 올라오고 있는 "예비" 키워드로 볼 상위 컷. */
const WATCH_FROM_RANK = 10;
const WATCH_LIMIT = 4;

// 수집 run이 계속 쌓이므로 페이지 자체는 매 요청 렌더한다(빌드 타임 프리렌더 금지 —
// 프리렌더로 돌리면 빌드가 백엔드 가동 여부에 묶인다). 데이터 캐시는 fetchApi가 맡는다.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [categoryResult, timelineResult, dailyResult] = await Promise.all([
    fetchApi<ApiResult<CategoryRow[]>>("/api/categories"),
    fetchApi<ApiResult<TimelineSnapshot[]>>("/api/trends/timeline"),
    fetchApi<ApiResult<TrendRow[]>>("/api/trends?period=daily"),
  ]);

  const categories = categoryResult.data.map((category) => category.name);
  const snapshots = timelineResult.data;
  const latest = snapshots.at(-1);

  // 스냅샷이 하나도 없으면 랭킹 보드를 그리지 않는다.
  // RankingBoard는 snapshots[index].rows / .ticker / .clock / .label을 가드 없이 읽어서,
  // 빈 배열이 들어오면 "Cannot read properties of undefined (reading 'rows')"로 홈이 통째로 죽는다.
  // 수집 run이 아직 없는 새 배포나 파이프라인 첫 실행 전에 실제로 일어난다.
  if (snapshots.length === 0) {
    return (
      <div className="page-shell">
        <main className="app-main">
          <Onboarding categories={categories} />
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">RANKING</p>
                <h3>아직 집계된 트렌드가 없습니다</h3>
              </div>
            </div>
            <div className="empty-state-box">
              <p>첫 수집이 끝나면 순위가 표시됩니다.</p>
            </div>
          </section>
        </main>
      </div>
    );
  }

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
