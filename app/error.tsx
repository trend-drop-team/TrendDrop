"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const RETRY_HINT_SECONDS = "10~20초";
// 세그먼트 재마운트마다 컴포넌트 state는 날아가므로, 반복 실패 판단은 모듈 스코프
// 카운터로 잡는다 — 새로고침(전체 리로드)하면 자연히 0으로 돌아가는 게 정확히 원하는 동작이다.
const REPEATED_FAILURE_THRESHOLD = 3;
let retryAttempts = 0;

/**
 * 루트 세그먼트 에러 바운더리.
 *
 * 홈·탐색·트렌드가 백엔드 HTTP 호출로 데이터를 받아오는데, 백엔드가 자거나 죽으면
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
  const [attempt, setAttempt] = useState(retryAttempts);
  const repeated = attempt >= REPEATED_FAILURE_THRESHOLD;

  useEffect(() => {
    // 서버 컴포넌트에서 난 에러는 클라이언트에 digest만 오므로, 원인 추적은 서버 로그와 digest를 맞춰 본다.
    console.error("[page error]", error.digest ?? "", error);
  }, [error]);

  function retryNow() {
    retryAttempts += 1;
    setAttempt(retryAttempts);
    reset();
  }

  function refreshPage() {
    retryAttempts = 0;
    location.reload();
  }

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
            {!repeated ? (
              <p>데이터 서버가 잠시 응답하지 않고 있습니다. {RETRY_HINT_SECONDS} 후 다시 시도해 주세요.</p>
            ) : (
              <p>
                여러 차례 다시 시도했지만 계속 실패하고 있습니다. 서버 점검 중일 수 있어요. 잠시 후
                다시 방문하시거나, 다른 메뉴를 이용해 주세요.
              </p>
            )}
            <p>같은 문제가 반복되면 새로고침을 먼저 눌러보세요. 그래도 안 되면 잠시 후 다시 방문해 주세요.</p>
            {error.digest && <p>오류 번호: {error.digest}</p>}
          </div>

          <div className="board-controls">
            {!repeated && (
              <button type="button" className="primary-button" onClick={retryNow}>
                다시 시도
              </button>
            )}
            <button type="button" className="secondary-button" onClick={refreshPage}>
              새로고침
            </button>
            <Link href="/" className="ghost-button link-button">
              홈으로 이동
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
