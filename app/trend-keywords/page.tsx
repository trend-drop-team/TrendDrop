import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { getDb, isDbConfigured } from "@/db";
import { keywords, sources, trendSnapshots } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function TrendKeywordsPage() {
  const rows = isDbConfigured()
    ? await getDb().select({ term: keywords.term, category: keywords.category, score: trendSnapshots.score, growth: trendSnapshots.growthRate, capturedAt: trendSnapshots.capturedAt })
        .from(trendSnapshots).innerJoin(keywords, eq(trendSnapshots.keywordId, keywords.id)).innerJoin(sources, eq(keywords.sourceId, sources.id))
        .where(eq(sources.kind, "google-trends")).orderBy(desc(trendSnapshots.capturedAt), desc(trendSnapshots.score)).limit(200)
    : [];

  return (
    <main className="collection-log-page">
      <div className="collection-log-header"><div>
        <Link href="/" className="collection-back">← 홈으로</Link>
        <p className="section-kicker">GOOGLE TRENDS</p><h1>1차 선별 키워드</h1>
        <p>Google Trends에서 처음 발견된 급상승 검색어만 표시합니다. YouTube와 Google News 결과는 포함하지 않습니다.</p>
      </div><span className="collection-count">총 {rows.length}건</span></div>
      {!isDbConfigured() ? <div className="collection-empty">DATABASE_URL을 설정하면 1차 키워드가 표시됩니다.</div> : rows.length === 0 ? <div className="collection-empty">아직 Google Trends 키워드가 없습니다. 홈에서 수집을 시작해 주세요.</div> : (
        <div className="collection-table-wrap"><table className="collection-table"><thead><tr><th>수집 일시</th><th>순위</th><th>키워드</th><th>카테고리</th><th>검색량</th><th>점수</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={`${row.term}-${row.capturedAt.toISOString()}-${index}`}><td>{row.capturedAt.toLocaleString("ko-KR")}</td><td>{(index % 10) + 1}</td><td><strong>{row.term}</strong></td><td>{row.category}</td><td>{row.growth ?? "급상승"}</td><td>{row.score ?? "-"}</td></tr>)}</tbody>
        </table></div>
      )}
    </main>
  );
}
