import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { getDb, isDbConfigured } from "@/db";
import { keywords, trendSnapshots } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function CollectionLogPage() {
  const rows = isDbConfigured()
    ? await getDb().select({
        term: keywords.term,
        category: keywords.category,
        score: trendSnapshots.score,
        source: trendSnapshots.sourceLabel,
        capturedAt: trendSnapshots.capturedAt,
        summary: trendSnapshots.summary,
      }).from(trendSnapshots).innerJoin(keywords, eq(trendSnapshots.keywordId, keywords.id))
        .orderBy(desc(trendSnapshots.capturedAt), desc(trendSnapshots.score)).limit(200)
    : [];

  return (
    <main className="collection-log-page">
      <div className="collection-log-header">
        <div>
          <Link href="/" className="collection-back">← 홈으로</Link>
          <p className="section-kicker">COLLECTION LOG</p>
          <h1>수집 키워드 기록</h1>
          <p>Google Trends에서 선별되고 YouTube·Google News로 가공된 키워드의 수집 이력입니다.</p>
        </div>
        <span className="collection-count">총 {rows.length}건</span>
      </div>
      {!isDbConfigured() ? (
        <div className="collection-empty">DATABASE_URL을 설정하면 수집 기록이 표시됩니다.</div>
      ) : rows.length === 0 ? (
        <div className="collection-empty">아직 수집된 키워드가 없습니다. 홈에서 수집을 시작해 주세요.</div>
      ) : (
        <div className="collection-table-wrap">
          <table className="collection-table">
            <thead><tr><th>수집 일시</th><th>키워드</th><th>카테고리</th><th>점수</th><th>출처</th><th>요약</th></tr></thead>
            <tbody>{rows.map((row, index) => <tr key={`${row.term}-${row.capturedAt.toISOString()}-${index}`}>
              <td>{row.capturedAt.toLocaleString("ko-KR")}</td>
              <td><strong>{row.term}</strong></td>
              <td>{row.category}</td>
              <td>{row.score ?? "-"}</td>
              <td>{row.source ?? "-"}</td>
              <td>{row.summary ?? "-"}</td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
    </main>
  );
}
