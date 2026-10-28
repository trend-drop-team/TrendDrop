import Link from "next/link";

/**
 * 루트 404. `notFound()`(트렌드·문서 상세)와 알 수 없는 주소가 함께 이 화면으로 온다.
 * error.tsx와 같은 panel / empty-state-box / 버튼 클래스를 써서 톤을 맞춘다.
 */
export default function NotFound() {
  return (
    <div className="page-shell">
      <main className="app-main">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">404</p>
              <h3>찾으시는 페이지가 없습니다</h3>
            </div>
          </div>

          <div className="empty-state-box">
            <p>주소가 잘못되었거나, 더 이상 순위에 없는 트렌드일 수 있어요.</p>
            <p>홈에서 지금 뜨는 트렌드를 보거나 탐색에서 다른 키워드를 찾아보세요.</p>
          </div>

          <div className="board-controls">
            <Link href="/" className="primary-button link-button">
              홈으로 이동
            </Link>
            <Link href="/explore" className="secondary-button link-button">
              탐색하기
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
