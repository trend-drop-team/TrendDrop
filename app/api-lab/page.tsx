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
        <section className="panel source-explainer">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">HOW KEYWORDS WORK</p>
              <h3>검색 키워드는 어디서 정하나</h3>
            </div>
          </div>
          <div className="source-explainer-grid">
            <article>
              <strong>1. 초기 seed keyword</strong>
              <p>
                MVP에서는 사람이 카테고리별 출발 키워드를 정합니다. 예: 유튜브 쇼츠, AI 서비스,
                틱톡 챌린지, 패션 트렌드, K팝 이슈.
              </p>
            </article>
            <article>
              <strong>2. YouTube Data API</strong>
              <p>
                seed keyword로 공개 영상을 검색하고, 제목·설명·채널명·조회수·좋아요·댓글 수를
                가져와 영상 반응 신호로 씁니다.
              </p>
            </article>
            <article>
              <strong>3. Google News RSS</strong>
              <p>
                같은 seed keyword로 최신 뉴스 묶음을 확인하고, 기사 제목·출처·발행일·링크를 뉴스
                언급 신호로 씁니다.
              </p>
            </article>
            <article>
              <strong>4. 다음 단계</strong>
              <p>
                뉴스 제목과 YouTube 제목에서 반복되는 단어를 뽑아 다음 seed 후보로 확장합니다.
              </p>
            </article>
          </div>
        </section>

        <ApiTestConsole />
      </main>
    </div>
  );
}
