/**
 * 루트 세그먼트 로딩 UI — 자체 loading.tsx가 없는 라우트(/, /explore, /trend, /docs)가
 * 공유한다. 홈 랭킹이 가장 무거우므로 랭킹 보드 모양에 맞춰 둔다.
 *
 * Neon 왕복이 200ms 가까이 걸려 렌더에 1초 이상 드는데, 이게 없으면 클릭 후
 * 화면이 그대로 멈춰 있어 "안 눌렸다"고 읽힌다.
 */
const ROWS = [0, 1, 2, 3, 4, 5];

export default function Loading() {
  return (
    <div className="page-shell" aria-busy="true" aria-label="불러오는 중">
      <main className="app-main">
        <section className="panel">
          <div className="sk-stack-lg">
            <div className="sk-stack">
              <span className="sk sk-kicker" />
              <span className="sk sk-title" />
            </div>

            <div>
              {ROWS.map((row) => (
                <div className="sk-rank-row" key={row}>
                  <span className="sk sk-rank-num" />
                  <div className="sk-rank-body">
                    <span className="sk sk-line sk-line-mid" />
                    <span className="sk sk-line sk-line-short" />
                  </div>
                  <span className="sk sk-rank-score" />
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
