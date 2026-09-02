/**
 * 인기 랭킹 추출(+저장) — raw_signals의 최신 버킷을 읽어 "지금 인기" top-N을
 * 계산한다. 매시간 job의 후반부.
 *
 * 실행:  node pipeline/rank-popular.mjs [--save]
 *   env: DATABASE_URL(필수), HOURS(기본 6), TOP_N(기본 10), POOL(기본 50)
 *        창은 "직전 N시간"이다(버킷 개수가 아님). 1시간이면 표본이 ~300행뿐이라
 *        유튜브·커뮤니티 신호가 2~3 언급에 그쳐 순위가 뭉갠다. 6시간이 실용적인 최소치.
 *   --save   계산 결과를 DB에 저장 (없으면 출력만 — 파라미터 튜닝용)
 *   --no-llm LLM 판정을 건너뛰고 순수 점수 순위만 본다 (비교용)
 *
 * LLM 필터는 후보를 POOL개로 넓게 뽑은 뒤 걸러 topN을 채운다.
 * 판정에서 40% 안팎이 탈락·병합되므로 topN만 뽑으면 최종이 모자란다.
 */
import { loadRecentItems, startRun, saveTrendSnapshots, finishRun, closeDb } from "./store.mjs";
import { rankPopular, WEIGHTS } from "./popular.mjs";
import { applyVerdicts } from "./verdict.mjs";

const save = process.argv.includes("--save");
const useLlm = !process.argv.includes("--no-llm");
const windowHours = Number(process.env.HOURS ?? 6) || 6;
const topN = Number(process.env.TOP_N ?? 10) || 10;
const poolSize = Number(process.env.POOL ?? 50) || 50;

const rows = await loadRecentItems(windowHours);
if (rows.length === 0) {
  console.error("raw_signals 가 비어 있음");
  await closeDb();
  process.exit(1);
}

const bucketAt = rows[rows.length - 1].bucketAt;
// 창 안에 실제로 존재한 버킷 수. windowHours보다 적으면 그만큼 수집이 빠진 것.
const buckets = new Set(rows.map((r) => r.bucketAt)).size;
const { ranked: pool, meta } = rankPopular(rows, { limit: poolSize, windowHours });
const { ranked, stats } = await applyVerdicts(pool, { topN, allowApi: useLlm });

const short = (s, n = 44) => (s.length > n ? s.slice(0, n) + "…" : s);
const kst = (iso) =>
  new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });

// 창 안의 소스 구성
const bySource = new Map();
for (const r of rows) {
  const k = `${r.site}|${r.kind}`;
  bySource.set(k, (bySource.get(k) ?? 0) + 1);
}

console.log("\n" + "═".repeat(72));
console.log("🔥 지금 인기 키워드 (pipeline · popular)");
console.log("═".repeat(72));
const missed = windowHours - buckets;
console.log(
  `창: 최근 ${windowHours}시간 / 기준 ${kst(bucketAt)} KST` +
    ` | 버킷 ${buckets}개${missed > 0 ? ` (⚠️ ${missed}회 수집 누락)` : ""}` +
    ` | 행 ${meta.rows.toLocaleString()}`
);
console.log(
  "구성: " +
    [...bySource.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${n}(w${WEIGHTS[k] ?? "-"})`)
      .join(", ")
);
console.log(
  `후보 ${meta.candidates} → 필터 통과 ${meta.passed}` +
    ` | 참여도 보정 적용 ${meta.boostedRows}행`
);
if (meta.skipped.length) {
  console.log(`⚠️ 가중치 미정의로 제외: ${meta.skipped.map((s) => `${s.key} ${s.n}`).join(", ")}`);
}

// LLM 판정 요약
if (!useLlm) {
  console.log(`🤖 LLM 판정: 건너뜀 (--no-llm)`);
} else if (stats.filtered) {
  console.log(
    `🤖 LLM 판정: 후보 ${poolSize} → 캐시 ${stats.cached} / 신규 ${stats.asked}` +
      ` | 제거 ${stats.dropped} · 병합 ${stats.merged}` +
      (stats.error ? `  ⚠️ ${stats.error}` : "")
  );
} else {
  console.log(`🤖 LLM 판정: 미적용 — ${stats.error ?? "판정 없음"} (원본 순위 그대로)`);
}

console.log("\n" + "─".repeat(72));
ranked.forEach((k, i) => {
  const src = k.sources.map((s) => `${s.source} ${s.weightSum}`).join(", ");
  const cross = k.crossed ? "  🔗교차" : "";
  const renamed = k.originalTerm && k.originalTerm !== k.term ? `  ←${k.originalTerm}` : "";
  const cat = k.category ? `[${k.category}] ` : "";
  console.log(
    `${String(i + 1).padStart(2)}. ${k.term.padEnd(14)} ${String(k.score).padStart(5)}점` +
      `  ${cat}(언급 ${k.mentions}, 소스 ${k.breadth})${cross}${renamed}`
  );
  console.log(`     ${src}`);
  console.log(`     예문: ${short(k.sample)}`);
});
console.log("");

if (save) {
  // 랭킹 run은 수집 run과 별개다(pipeline='popular') — 이 파이프라인은
  // 수집·랭킹이 분리돼 있어 이 run이 raw_signals가 아니라 trend_snapshots를 소유한다.
  const runId = await startRun({ pipeline: "popular", geo: "KR", bucketAt, windowHours, buckets });
  await saveTrendSnapshots(runId, bucketAt, ranked);
  await finishRun(runId, {
    status: "success",
    rawSignalCount: rows.length,
    keywordCount: ranked.length,
    filtered: stats.filtered,
  });
  console.log(`💾 popular run #${runId} 저장 — snapshots ${ranked.length}건\n`);
}

await closeDb();
