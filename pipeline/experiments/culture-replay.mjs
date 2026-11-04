import { loadRecentItems, loadExtractions, loadAliases, closeDb } from "../store.mjs";
import { rankIssues } from "../issues.mjs";

const version = process.argv[2] ?? "issue-v17";
try {
  const rows = await loadRecentItems(6);
  const hashes = [...new Set(rows.map((row) => row.textHash))];
  const extractions = await loadExtractions(hashes, version);
  const aliases = await loadAliases();
  const sources = Object.fromEntries([...new Set(rows.map((row) => row.site))].map((site) => [site,
    new Set(rows.filter((row) => row.site === site).map((row) => row.textHash)).size,
  ]));
  const targets = process.argv.slice(3);
  for (const term of targets) {
    const matched = rows.filter((row) => row.text.includes(term));
    console.log(JSON.stringify({ term, rawTexts: new Set(matched.map((row) => row.textHash)).size,
      evidence: [...new Map(matched.map((row) => [row.textHash, { site: row.site, text: row.text,
        extraction: extractions.get(row.textHash) ?? null }])).values()].slice(0, 5) }));
  }
  console.log(JSON.stringify({ sources }));
  console.log(JSON.stringify({ version, rows: rows.length, unique: hashes.length, cached: extractions.size }));
  if (extractions.size < hashes.length * 0.9) {
    throw new Error(`캐시 커버리지가 90% 미만입니다. ${version} 결과를 현재 랭킹의 재현으로 해석할 수 없습니다.`);
  }
  for (const profile of ["general", "culture", "discovery"]) {
    const useReview = process.env.DISCOVERY_REVIEW === "1" && profile === "discovery";
    const { ranked, review } = await rankIssues(rows, extractions, new Map(aliases), { profile, useReview });
    console.log(JSON.stringify({ profile, review: useReview, reviewError: review.error, ranked: ranked.map(({ term, category, score, mentions }) => ({ term, category, score, mentions })) }));
  }
} finally {
  await closeDb();
}
