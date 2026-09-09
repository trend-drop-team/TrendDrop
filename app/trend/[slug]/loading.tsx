import "../trend.css";

/**
 * 트렌드 상세 로딩 UI. 실제 페이지와 같은 컨테이너(.td-content/.td-metrics/.td-panel)를
 * 써서, 데이터가 도착해도 블록 위치가 그대로 유지되도록 한다.
 */
const STATS = [0, 1, 2, 3];

export default function Loading() {
  return (
    <div className="td" aria-busy="true" aria-label="불러오는 중">
      <div className="td-content">
        <div className="td-topbar">
          <span className="sk sk-h2" />
          <span className="sk sk-pill" />
        </div>

        <section className="td-hero">
          <div className="sk-stack">
            <span className="sk sk-kicker" />
            <span className="sk sk-title" />
            <span className="sk sk-byline" />
          </div>
        </section>

        <section className="td-metrics">
          {STATS.map((stat) => (
            <div className="td-stat" key={stat}>
              <span className="sk sk-stat-value" />
              <span className="sk sk-stat-label" />
            </div>
          ))}
        </section>

        <section className="td-panel">
          <div className="sk-stack-lg">
            <span className="sk sk-h2" />
            <span className="sk sk-chart" />
          </div>
        </section>

        <section className="td-panel">
          <div className="sk-stack">
            <span className="sk sk-kicker" />
            <span className="sk sk-line" />
            <span className="sk sk-line sk-line-mid" />
            <span className="sk sk-line sk-line-short" />
          </div>
        </section>
      </div>
    </div>
  );
}
