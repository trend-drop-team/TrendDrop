import Link from "next/link";

import { ApiTestConsole } from "@/components/api-test-console";

export default function ApiLabPage() {
  return (
    <div className="page-shell api-lab-shell">
      <header className="hero">
        <nav className="topbar">
          <div className="brand">
            <span className="brand-mark">TD</span>
            <div>
              <p className="brand-name">TrendDrop</p>
              <p className="brand-sub">Trend source lab</p>
            </div>
          </div>
          <div className="link-cluster">
            <Link className="ghost-button link-button" href="/">
              홈으로 돌아가기
            </Link>
            <Link className="ghost-button link-button" href="/docs/google-api-research">
              Google 소스 정리
            </Link>
          </div>
        </nav>

        <section className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">PUBLIC TREND SOURCES</p>
            <h1>외부 트렌드 후보를 수집하는 테스트 페이지</h1>
            <p className="hero-text">
              지금 단계에서는 내 광고 계정, 내 사이트, 내 채널 데이터가 아니라 공개 웹에서 확인 가능한
              신호만 씁니다. YouTube Data API와 Google News RSS를 버튼으로 호출하고 결과를 바로
              확인합니다.
            </p>
          </div>

          <aside className="pulse-panel">
            <div className="pulse-header">
              <p>현재 사용 소스</p>
              <span>MVP 기준</span>
            </div>
            <ul className="pulse-list">
              <li>
                <span>1</span>
                <strong>YouTube Data API</strong>
              </li>
              <li>
                <span>2</span>
                <strong>Google News RSS</strong>
              </li>
              <li>
                <span>DB</span>
                <strong>Neon 저장 후 조회</strong>
              </li>
            </ul>
          </aside>
        </section>
      </header>

      <main className="dashboard">
        <ApiTestConsole />
      </main>
    </div>
  );
}
