/**
 * 과거 시간대 재계산 — 최근 N시간의 정시마다 새 방식(이슈 추출)으로 top10을 다시 만든다.
 *
 * 실행:  node --env-file=.env.local pipeline/backfill-issues.mjs [--save] [--replace-all]
 *   env: HOURS_BACK(기본 48) — 몇 시간 전까지 거슬러 올라갈지
 *   --save         DB에 쓴다 (없으면 시간대별 top3만 출력)
 *   --replace-all  새 run을 다 만든 뒤, 이번에 만든 것 외의 popular run·trend_snapshots를 **전부** 지우고
 *                  어떤 순위·즐겨찾기에도 안 남은 keywords 행을 정리한다
 *                  (2026-10-14 옛 단어 방식 기록을 걷어낼 때 썼다)
 *
 * 순서: 오래된 시간대부터. growth_rate가 "직전 popular run"과 비교하므로 시간순으로 만들어야 한다.
 * 새 run을 먼저 다 만들고 옛 기록은 마지막에 지운다 — 도는 동안에도 앱 데이터가 비지 않게.
 *
 * LLM 호출: 창 안 글은 1단계에서 한꺼번에 추출(Lite, 50줄씩)하고, 시간대마다 검수 3회.
 * Lite 무료 한도가 분당 15회라 시간대마다 최소 13초 간격을 둔다.
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
import { extractMissing, rankIssues, PROMPT_VERSION } from "./issues.mjs";

const save = process.argv.includes("--save");
const replaceAll = process.argv.includes("--replace-all");
const hoursBack = Number(process.env.HOURS_BACK ?? 48) || 48;
const WINDOW = 6;
const TOP_N = 10;
const MIN_STEP_MS = 13_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kst = (iso) =>
  new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });

if (replaceAll && !save) throw new Error("--replace-all은 --save와 같이 써야 한다");

// 1. 전체 기간(가장 오래된 창 시작 ~ 지금) 글을 한 번에 추출해 둔다
const all = await loadRecentItems(hoursBack + WINDOW);
const aliases = await loadAliases();
const extractions = await loadExtractions([...new Set(all.map((r) => r.textHash))], PROMPT_VERSION);
console.log(`글 ${new Set(all.map((r) => r.textHash)).size}개 중 캐시 ${extractions.size}개 — 나머지 추출 중…`);
const ext = await extractMissing(all, extractions, aliases, {
  onBatch: save ? (entries) => saveExtractions(entries, PROMPT_VERSION) : undefined,
});
console.log(`추출: 신규 ${ext.extracted}` + (ext.skipped ? ` / ⚠️ 못 뽑음 ${ext.skipped} (${ext.error})` : ""));
if (ext.skipped) {
  // 한도 소진 등 — 반쪽 데이터로 과거를 덮어쓰지 않는다. 캐시는 저장됐으니 다시 돌리면 이어서 뽑는다
  await closeDb();
  throw new Error("추출을 다 못 해서 중단. 한도가 풀린 뒤 다시 실행하면 이어서 뽑는다");
}

// 2. 정시마다 순위 — 오래된 것부터
const latest = Date.parse(all[all.length - 1].bucketAt);
const buckets = [...new Set(all.map((r) => r.bucketAt))]
  .filter((b) => Date.parse(b) > latest - hoursBack * 3600_000)
  .sort();
const newRunIds = [];
for (const bucketAt of buckets) {
  const t = Date.now();
  const offsetHours = Math.round((latest - Date.parse(bucketAt)) / 3600_000);
  const rows = await loadRecentItems(WINDOW, { offsetHours });
  const before = new Map(aliases);
  const { ranked, review } = await rankIssues(rows, extractions, aliases, { topN: TOP_N, windowHours: WINDOW });
  console.log(
    `${kst(bucketAt)}  ${ranked.slice(0, 3).map((k) => k.term).join(" · ")}` +
      (review.error ? `  ⚠️ ${review.error.slice(0, 60)}` : "")
  );
  if (save) {
    await saveAliases([...aliases].filter(([a, c]) => before.get(a) !== c), review.model);
    const runId = await startRun({
      pipeline: "popular", geo: "KR", bucketAt, windowHours: WINDOW,
      buckets: new Set(rows.map((r) => r.bucketAt)).size,
    });
    newRunIds.push(runId);
    await saveTrendSnapshots(runId, bucketAt, ranked);
    await finishRun(runId, {
      status: review.error ? "partial" : "success",
      rawSignalCount: rows.length,
      keywordCount: ranked.length,
      filtered: !review.error,
      apiCallLog: { promptVersion: PROMPT_VERSION, backfill: true, review: review.model ? { model: review.model } : null },
      errorMessage: review.error,
    });
  }
  const left = MIN_STEP_MS - (Date.now() - t);
  if (left > 0) await sleep(left);
}

// 3. 옛 기록 정리
if (replaceAll && newRunIds.length) {
  const { default: postgres } = await import("postgres");
  const s = postgres(process.env.DATABASE_URL, { prepare: false });
  await s.begin(async (tx) => {
    // 이번에 만든 run이 아닌 popular run 전부 — 도는 사이 cron이 끼워 넣은 옛 방식 run도 포함
    const old = await tx`SELECT id FROM collection_runs WHERE pipeline = 'popular' AND NOT (id = ANY(${newRunIds}))`;
    const ids = old.map((r) => r.id);
    const snaps = await tx`DELETE FROM trend_snapshots WHERE run_id = ANY(${ids})`;
    const runs = await tx`DELETE FROM collection_runs WHERE id = ANY(${ids})`;
    // 어디에서도 안 쓰는 키워드만 — 즐겨찾기·근거 콘텐츠·연관 키워드·서지 에피소드가 가리키면 남긴다
    const kw = await tx`DELETE FROM keywords k
      WHERE NOT EXISTS (SELECT 1 FROM trend_snapshots t WHERE t.keyword_id = k.id)
        AND NOT EXISTS (SELECT 1 FROM watchlist_items w WHERE w.keyword_id = k.id)
        AND NOT EXISTS (SELECT 1 FROM trend_contents c WHERE c.keyword_id = k.id)
        AND NOT EXISTS (SELECT 1 FROM keyword_relations r WHERE r.keyword_id = k.id OR r.related_keyword_id = k.id)
        AND NOT EXISTS (SELECT 1 FROM trend_surge_episodes e WHERE e.keyword_id = k.id)`;
    console.log(`\n옛 기록 삭제: popular run ${runs.count}건, trend_snapshots ${snaps.count}행, 안 쓰는 keywords ${kw.count}행`);
  });
  await s.end();
}

await closeDb();
console.log(save ? `\n새 run ${newRunIds.length}건 저장 (#${newRunIds[0]}~#${newRunIds.at(-1)})` : "\n(저장 안 함 — --save로 실행하면 DB에 쓴다)");
