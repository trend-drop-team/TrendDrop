/**
 * 백필 — 쌓아둔 raw_signals 전체를 시간순으로 되감아, 매 버킷마다 그 시점의
 * "지금 인기" 랭킹을 계산해 collection_runs(pipeline='popular') /
 * trend_snapshots에 채워 넣는다. 매시간 job이 처음부터 돌았다면 나왔을 결과를 재구성하는 것.
 *
 * 각 시점 T: 창 = T를 포함한 직전 HOURS시간 (rank-popular.mjs와 같은 규칙).
 * 수집이 빠진 구간에서는 버킷 수가 줄어들 뿐 과거로 뻗지 않는다.
 *
 * 실행:  node pipeline/backfill-popular.mjs [--reset]
 *   env: DATABASE_URL(필수), HOURS(기본 6), TOP_N(기본 10), POOL(기본 50)
 *   --reset : 기존 popular run/trend_snapshots를 비우고 새로 채운다
 *             (collect run/raw_signals는 건드리지 않음).
 *
 * 주의: statistics(조회수·좋아요)는 수집을 최근에 시작했으므로 과거 구간의
 * videoBoost는 대부분 ×1이다. trafficBoost(gtrends)는 전 구간 적용된다.
 */
import { loadAllItems, startRun, saveTrendSnapshots, finishRun, closeDb } from "./store.mjs";
import { rankPopular } from "./popular.mjs";
import { applyVerdicts } from "./verdict.mjs";

const reset = process.argv.includes("--reset");
const WINDOW_HOURS = Number(process.env.HOURS ?? 6) || 6;
const topN = Number(process.env.TOP_N ?? 10) || 10;
const POOL = Number(process.env.POOL ?? 50) || 50;
const HOUR_MS = 3600e3;

const rows = await loadAllItems();
if (rows.length === 0) {
  console.error("raw_signals 가 비어 있음");
  await closeDb();
  process.exit(1);
}

// 버킷별로 묶기 (버킷은 수집 누락으로 불연속일 수 있다)
const byBucket = new Map();
for (const r of rows) {
  let list = byBucket.get(r.bucketAt);
  if (!list) byBucket.set(r.bucketAt, (list = []));
  list.push(r);
}
const buckets = [...byBucket.keys()].sort();
const bucketMs = buckets.map((b) => Date.parse(b));

console.log(
  `\n원문 ${rows.length.toLocaleString()}행 / 버킷 ${buckets.length}개` +
    ` (${buckets[0].slice(0, 10)} ~ ${buckets[buckets.length - 1].slice(0, 10)})`
);
console.log(`창 ${WINDOW_HOURS}시간, top${topN} → 시점 ${buckets.length}개 계산\n`);

if (reset) {
  // collection_runs는 이제 collect run과 공유하는 테이블이라 통째로 TRUNCATE하면
  // raw_signals.run_id FK가 깨진다 — pipeline='popular'인 것만 지운다.
  const { default: postgres } = await import("postgres");
  const s = postgres(process.env.DATABASE_URL, { prepare: false, onnotice: () => {} });
  await s`DELETE FROM trend_snapshots
    WHERE run_id IN (SELECT id FROM collection_runs WHERE pipeline = 'popular')`;
  await s`DELETE FROM collection_runs WHERE pipeline = 'popular'`;
  await s.end();
  console.log("🧹 popular run / trend_snapshots 비움 (keywords는 유지)\n");
}

let runs = 0;
let snapshots = 0;
const firstSeen = new Map(); // term → 처음 top10에 든 시점 (진단용)

for (let i = 0; i < buckets.length; i++) {
  // 시계 기준 창: T - HOURS < bucket <= T. 앞으로 훑으며 하한을 넘는 첫 인덱스를 찾는다.
  const cutoff = bucketMs[i] - WINDOW_HOURS * HOUR_MS;
  let start = i;
  while (start > 0 && bucketMs[start - 1] > cutoff) start -= 1;

  const window = buckets.slice(start, i + 1);
  const windowRows = window.flatMap((b) => byBucket.get(b));
  const { ranked: pool } = rankPopular(windowRows, { limit: POOL });
  if (pool.length === 0) continue;

  // allowApi:false — 백필은 절대 API를 호출하지 않는다. 147시점 × 신규 term을
  // 그때그때 물어보면 비용도 시간도 감당이 안 된다. 캐시는 warm-verdicts.mjs가 채운다.
  const { ranked, stats } = await applyVerdicts(pool, { topN, allowApi: false });
  if (ranked.length === 0) continue;

  const runId = await startRun({
    pipeline: "popular",
    geo: "KR",
    bucketAt: buckets[i],
    windowHours: WINDOW_HOURS,
    buckets: window.length,
  });
  await saveTrendSnapshots(runId, buckets[i], ranked);
  await finishRun(runId, {
    status: "success",
    rawSignalCount: windowRows.length,
    keywordCount: ranked.length,
    filtered: stats.filtered,
  });
  runs += 1;
  snapshots += ranked.length;

  for (const k of ranked.slice(0, 10)) {
    if (!firstSeen.has(k.term)) firstSeen.set(k.term, buckets[i]);
  }

  if (runs % 20 === 0 || i === buckets.length - 1) {
    const top = ranked
      .slice(0, 5)
      .map((k) => `${k.term}(${k.score})`)
      .join(" · ");
    console.log(`  ${buckets[i].slice(5, 16).replace("T", " ")}Z  창${window.length}  ${top}`);
  }
}

console.log(`\n💾 popular run ${runs}건 / trend_snapshots ${snapshots.toLocaleString()}건 저장`);
console.log(`   top10에 한 번이라도 든 키워드: ${firstSeen.size}개\n`);

await closeDb();
