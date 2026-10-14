/**
 * 인기 랭킹 추출(+저장) — raw_signals의 최근 창을 읽어 "지금 인기" top-N을
 * 계산한다. 매시간 job의 후반부. 흐름은 issues.mjs 머리말 참고(추출 → 점수 → 검수).
 *
 * 실행:  node pipeline/rank-popular.mjs [--save]
 *   env: DATABASE_URL·GEMINI_API_KEY(필수), HOURS(기본 6), TOP_N(기본 10)
 *        창은 "직전 N시간"이다(버킷 개수가 아님). 1시간이면 표본이 ~300행뿐이라
 *        유튜브·커뮤니티 신호가 2~3 언급에 그쳐 순위가 뭉갠다. 6시간이 실용적인 최소치.
 *   --save       추출 결과·이름 사전·순위를 DB에 저장 (없으면 LLM은 부르되 출력만)
 *   --no-review  최종 검수를 건너뛴다 (비교용)
 */
import {
  loadRecentItems,
  loadExtractions,
  saveExtractions,
  loadAliases,
  saveAliases,
  startRun,
  saveTrendSnapshots,
  finishRun,
  closeDb,
} from "./store.mjs";
import { WEIGHTS } from "./popular.mjs";
import { extractMissing, rankIssues, PROMPT_VERSION } from "./issues.mjs";

const save = process.argv.includes("--save");
const useReview = !process.argv.includes("--no-review");
const windowHours = Number(process.env.HOURS ?? 6) || 6;
const topN = Number(process.env.TOP_N ?? 10) || 10;

const rows = await loadRecentItems(windowHours);
if (rows.length === 0) {
  console.error("raw_signals 가 비어 있음");
  await closeDb();
  process.exit(1);
}

const bucketAt = rows[rows.length - 1].bucketAt;
// 창 안에 실제로 존재한 버킷 수. windowHours보다 적으면 그만큼 수집이 빠진 것.
const buckets = new Set(rows.map((r) => r.bucketAt)).size;

const aliases = await loadAliases();
const extractions = await loadExtractions([...new Set(rows.map((r) => r.textHash))], PROMPT_VERSION);
let ext;
try {
  ext = await extractMissing(rows, extractions, aliases, {
    onBatch: save ? (entries) => saveExtractions(entries, PROMPT_VERSION) : undefined,
  });
} catch (err) {
  // 키 문제(400/401/403) — 순위를 낼 수 없으니 저장하지 않고 실패 종료
  console.error(`::error::이슈 추출 실패 — ${err.message}`);
  await closeDb();
  process.exit(1);
}
const before = new Map(aliases);
const { ranked, meta, review } = await rankIssues(rows, extractions, aliases, { topN, windowHours, useReview });
const errors = [ext.error, review.error].filter(Boolean);

const short = (s, n = 44) => (s.length > n ? s.slice(0, n) + "…" : s);
const kst = (iso) =>
  new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });

// 창 안의 소스 구성
const bySource = new Map();
for (const r of rows) {
  const k = `${r.site}|${r.kind}`;
  bySource.set(k, (bySource.get(k) ?? 0) + 1);
}
const weights = WEIGHTS;

console.log("\n" + "═".repeat(72));
console.log("🔥 지금 인기 키워드 (pipeline · issues)");
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
      .map(([k, n]) => `${k} ${n}(w${weights[k] ?? "-"})`)
      .join(", ")
);
const extracted = [...new Set(rows.map((r) => r.textHash))].map((h) => extractions.get(h)).filter(Boolean);
const empty = extracted.filter((e) => e.keywords.length === 0).length;
console.log(
  `🤖 추출(${PROMPT_VERSION}): 고유 글 ${ext.unique} → 캐시 ${ext.cached} / 신규 ${ext.extracted}` +
    (ext.models.size ? ` (${[...ext.models].map(([m, n]) => `${m} ×${n}`).join(", ")})` : "") +
    (ext.skipped ? ` | ⚠️ 못 뽑음 ${ext.skipped}` : "") +
    ` | 키워드 없는 글 ${Math.round((100 * empty) / Math.max(extracted.length, 1))}%` +
    (ext.rejected ? ` | 원문에 없어 버림 ${ext.rejected}` : "")
);
if (!useReview) {
  console.log("🤖 검수: 건너뜀 (--no-review)");
} else if (review.error) {
  console.log(`🤖 검수: ⚠️ ${review.error} (검수 없이 순위 냄)`);
} else {
  console.log(
    `🤖 검수(${review.model}, 응답 ${review.votes}, 과반 적용): 제거 ${review.drop.size}` +
      (review.drop.size ? ` [${[...review.drop].map(([n, r]) => `${n}: ${short(r, 24)}`).join(" / ")}]` : "") +
      ` · 병합 ${review.merge.length}` +
      (review.merge.length ? ` [${review.merge.map(([a, b]) => `${a}→${b}`).join(", ")}]` : "")
  );
}

console.log("\n" + "─".repeat(72));
ranked.forEach((k, i) => {
  const src = k.sources.map((s) => `${s.source} ${s.weightSum}`).join(", ");
  const cross = k.crossed ? "  🔗교차" : "";
  const cat = k.category ? `[${k.category}] ` : "";
  console.log(
    `${String(i + 1).padStart(2)}. ${k.term.padEnd(14)} ${String(k.score).padStart(5)}점` +
      `  ${cat}(언급 ${k.mentions}, 소스 ${k.breadth})${cross}`
  );
  console.log(`     ${src} | 내부 이슈(저장 안 함): ${k.summary ?? "-"}`);
  console.log(`     예문: ${short(k.sample)}`);
});
console.log("");

if (save) {
  // 검수가 새로 묶은 이름만 사전에 쌓는다
  const newAliases = [...aliases].filter(([a, c]) => before.get(a) !== c);
  await saveAliases(newAliases, review.model);
  // 랭킹 run은 수집 run과 별개다(pipeline='popular') — 이 run이 trend_snapshots를 소유한다.
  const runId = await startRun({ pipeline: "popular", geo: "KR", bucketAt, windowHours, buckets });
  await saveTrendSnapshots(runId, bucketAt, ranked);
  // 추출이 일부 실패하거나 검수가 실패해도 순위는 저장한다(그 시각이 비면 안 되므로).
  // 대신 run을 partial로 남기고 에러를 기록한다 — success로 덮으면 실패가 묻힌다.
  // (2026-09-02~10-14, API 키가 무효인 채로 6주간 success로만 찍혀 아무도 몰랐다)
  await finishRun(runId, {
    status: errors.length ? "partial" : "success",
    rawSignalCount: rows.length,
    keywordCount: ranked.length,
    filtered: useReview && !review.error,
    // 어느 모델이 답했는지 — 예비 모델로 넘어간 빈도(=한도 소진)를 사후에 셀 수 있다.
    apiCallLog: {
      promptVersion: PROMPT_VERSION,
      extract: { cached: ext.cached, extracted: ext.extracted, skipped: ext.skipped, models: Object.fromEntries(ext.models) },
      review: review.model ? { model: review.model, dropped: review.drop.size, merged: review.merge.length } : null,
      fallbackReason: [ext.fallbackReason, review.fallbackReason].filter(Boolean).join(" / ") || null,
    },
    errorMessage: errors.length ? errors.join(" / ") : null,
  });
  console.log(`💾 popular run #${runId} 저장 — snapshots ${ranked.length}건, 추출 ${ext.extracted}건, 사전 +${newAliases.length}\n`);
}

await closeDb();

// 예비 모델로 넘어간 건 실패가 아니다 — 답은 받았으므로 경고로만 남긴다.
for (const reason of [ext.fallbackReason, review.fallbackReason].filter(Boolean)) {
  console.log(`::warning::예비 모델로 넘어감 — ${reason}`);
}

// 실패는 저장을 마친 뒤 마지막에 실패 종료로 드러낸다.
// Actions가 빨간 X가 되어 실패 메일이 오고, ::error::는 실행 요약에 사유로 뜬다.
if (errors.length) {
  console.error(`::error::${errors.join(" / ")}`);
  process.exitCode = 1;
}
