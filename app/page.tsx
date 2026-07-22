import Link from "next/link";

import { categories, timelineSteps, watchItems } from "@/lib/trend-data";
import { getTrendFeed } from "@/lib/trends-service";
import CollectionControls from "@/components/collection-controls";

export default async function HomePage() {
  const { data: trends } = await getTrendFeed();
  return (
    <div className="page-shell">
      <header className="hero">
        <nav className="topbar">
          <div className="brand">
            <span className="brand-mark">TD</span>
            <div>
              <p className="brand-name">TrendDrop</p>
              <p className="brand-sub">Social spike tracker</p>
            </div>
          </div>
          <Link className="ghost-button link-button" href="/docs">
            리서치 문서 보기
          </Link>
        </nav>

        <section className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">VERCEL + NEON STARTER</p>
            <h1>SNS에서 막 치솟는 관심사를 한눈에 모아보는 트렌드 허브</h1>
            <p className="hero-text">
              TrendDrop은 인스타그램, 페이스북, 커뮤니티, 숏폼 채널에서 반응이 급증하는 키워드를
              모아 왜 뜨는지와 얼마나 빠르게 확산되는지까지 보여주는 웹앱을 목표로 합니다.
            </p>
            <div className="hero-actions">
              <Link className="primary-button link-button" href="#trend-grid">
                트렌드 둘러보기
              </Link>
              <Link className="secondary-button link-button" href="/api-lab">
                API 테스트 페이지
              </Link>
              <Link className="secondary-button link-button" href="/docs/google-api-research">
                API 조사 보기
              </Link>
            </div>
          </div>

          <aside className="pulse-panel">
            <div className="pulse-header">
              <p>백엔드 기본 구조</p>
              <span>Next.js + Neon</span>
            </div>
            <div className="pulse-score">
              <strong>3</strong>
              <p>초기 핵심 레이어</p>
            </div>
            <ul className="pulse-list">
              <li>
                <span>Frontend / API</span>
                <strong>Vercel</strong>
              </li>
              <li>
                <span>Database</span>
                <strong>Neon Postgres</strong>
              </li>
              <li>
                <span>ORM</span>
                <strong>Drizzle</strong>
              </li>
            </ul>
          </aside>
        </section>
      </header>

      <main className="dashboard">
        <CollectionControls />
        <section className="section-heading">
          <div>
            <p className="section-kicker">LIVE SIGNALS</p>
            <h2>지금 사람들의 반응이 빠르게 모이는 트렌드</h2>
          </div>
          <div className="filter-row">
            {categories.map((category) => (
              <span
                key={category}
                className={`filter-chip ${category === "전체" ? "active" : ""}`}
              >
                {category}
              </span>
            ))}
          </div>
        </section>

        <section className="trend-grid" id="trend-grid">
          {trends.map((trend, index) => (
            <article className="trend-card" key={`${trend.keyword}-${trend.rank ?? index}-${index}`}>
              <div className="trend-head">
                <div>
                  <div className="trend-rank">#{trend.rank}</div>
                  <h3>{trend.keyword}</h3>
                </div>
                <span className="trend-tag">{trend.category}</span>
              </div>
              <p className="trend-meta">{trend.summary}</p>
              <div className="trend-stats">
                <div className="stat-block">
                  <div className="stat-value">{trend.growth}</div>
                  <p className="stat-label">검색 상승률</p>
                </div>
                <div className="stat-block">
                  <div className="stat-value">{trend.velocity}</div>
                  <p className="stat-label">확산 속도</p>
                </div>
              </div>
              <p className="trend-meta">
                <strong>왜 뜨나:</strong> {trend.reason}
              </p>
              <p className="trend-source">감지 채널: {trend.source}</p>
            </article>
          ))}
        </section>

        <section className="insight-layout">
          <article className="panel timeline-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">WHY NOW</p>
                <h3>트렌드가 뜨는 패턴</h3>
              </div>
            </div>
            <div className="timeline">
              {timelineSteps.map((item) => (
                <div className="timeline-step" key={item.step}>
                  <strong>{item.step}</strong>
                  <div>
                    <h4>{item.title}</h4>
                    <p>{item.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="panel watchlist-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">WATCHLIST</p>
                <h3>예비 급상승 키워드</h3>
              </div>
            </div>
            <ul className="watchlist">
              {watchItems.map((item, index) => (
                <li key={`${item.keyword}-${index}`}>
                  <div className="watch-keyword">
                    <strong>{item.keyword}</strong>
                    <p className="watch-meta">{item.meta}</p>
                  </div>
                  <span className="watch-score">{item.score}</span>
                </li>
              ))}
            </ul>
          </article>
        </section>

        <section className="panel starter-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">STARTER STACK</p>
              <h3>지금 들어간 프로젝트 기반</h3>
            </div>
          </div>
          <div className="starter-grid">
            <div className="starter-card">
              <strong>App Router</strong>
              <p>홈, 문서, API 라우트를 Next.js App Router 기준으로 구성했습니다.</p>
            </div>
            <div className="starter-card">
              <strong>Neon 준비</strong>
              <p>
                <code>DATABASE_URL</code> 기반 연결 함수와 Drizzle 스키마 초안을 추가했습니다.
              </p>
            </div>
            <div className="starter-card">
              <strong>문서 뷰어</strong>
              <p>루트의 markdown 문서를 서버 컴포넌트에서 읽어 브라우저에서 바로 볼 수 있습니다.</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
