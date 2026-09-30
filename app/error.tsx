"use client";

import { useEffect } from "react";

/**
 * 루트 세그먼트 에러 바운더리.
 *
 * 홈·탐색·트렌드가 전부 백엔드 HTTP 호출로 바뀌면서, 백엔드가 자거나 죽으면
 * 페이지가 통째로 Next 기본 500 화면(흰 바탕에 영문 한 줄)으로 떨어진다.
 * 그 자리를 "무엇이 안 됐고 지금 뭘 할 수 있는지" 읽히는 화면으로 대신한다.
 *
 * 자체 error.tsx가 없는 하위 라우트(/, /explore, /trend, /trend/[slug], /docs)가 공유한다.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 서버 컴포넌트에서 난 에러는 클라이언트에 digest만 오므로, 원인 추적은 서버 로그와 digest를 맞춰 본다.
    console.error("[page error]", error.digest ?? "", error);
  }, [error]);

  return (
    <div className="page-shell">
      <main className="app-main">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">ERROR</p>
              <h3>트렌드 데이터를 불러오지 못했습니다</h3>
            </div>
          </div>

          <div className="empty-state-box">
            <p>
              데이터 서버가 잠시 응답하지 않고 있습니다. 잠깐 뒤에 다시 시도하면 대부분 복구됩니다.
            </p>
            {error.digest && <p>오류 번호: {error.digest}</p>}
          </div>

          <div className="board-controls">
            <button type="button" className="primary-button" onClick={reset}>
              다시 시도
            </button>
            <button type="button" className="secondary-button" onClick={() => location.reload()}>
              새로고침
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
