/**
 * 수집 오케스트레이션 — 5소스를 병렬 스크래핑해 1시간 버킷으로 raw_signals에 축적.
 * trend-collector src/jobs/collect-sources.ts 에서 이전(SQLite→Postgres).
 *
 * 실행:  node trend-rising/collect.mjs
 *   env: YOUTUBE_API_KEY, REGION_CODE (유튜브용), DATABASE_URL (저장용)
 *   DATABASE_URL 없으면 스크랩만 하고 저장은 스킵(스크래퍼 검증용).
 */
import { createHash } from "node:crypto";

import { collect as dcbest } from "./sources/dcbest.mjs";
import { collect as theqoo } from "./sources/theqoo.mjs";
import { collect as instiz } from "./sources/instiz.mjs";
import { collect as youtube } from "./sources/youtube.mjs";
import { collect as gtrends } from "./sources/gtrends.mjs";
import { insertRawItems, startRun, finishRun, closeDb } from "./store.mjs";

// 네이트판은 2026-08-03에 제외했다 — 사연·신변잡기 위주라 트렌드 키워드가 거의 안 나왔다.
const ADAPTERS = [
  ["dcbest", dcbest],
  ["theqoo", theqoo],
  ["instiz", instiz],
  ["youtube", youtube],
  ["gtrends", gtrends],
];

const sha1 = (s) => createHash("sha1").update(s).digest("hex");

/** 1시간 floor 버킷 (UTC ISO). */
function hourBucket(d) {
  const x = new Date(d);
  x.setMinutes(0, 0, 0);
  return x.toISOString();
}

async function runAdapter([name, fn]) {
  try {
    return { name, items: await fn() };
  } catch (err) {
    return { name, items: [], error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  const now = new Date();
  const bucket = hourBucket(now);
  const collectedAt = now.toISOString();
  const kst = now.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

  console.log(`\n🗂  ${ADAPTERS.length}소스 수집 — 버킷 ${bucket} (${kst} KST)\n`);

  const results = await Promise.all(ADAPTERS.map(runAdapter));

  // raw_signals 형식으로 평탄화 (dedup 키: source_site, text_hash, bucket_at)
  const rows = [];
  console.log("소스        수집");
  console.log("─".repeat(28));
  for (const r of results) {
    if (r.error) {
      console.log(`${r.name.padEnd(10)}  ⚠️ ${r.error.slice(0, 40)}`);
      continue;
    }
    console.log(`${r.name.padEnd(10)}  ${String(r.items.length).padStart(4)}`);
    for (const it of r.items) {
      rows.push({
        site: it.source,
        kind: it.unit,
        text: it.text,
        textHash: sha1(it.text),
        meta: it.meta ?? null,
        bucketAt: bucket,
        capturedAt: collectedAt,
      });
    }
  }
  console.log("─".repeat(28));
  console.log(`총 수집 ${rows.length}건`);

  if (!process.env.DATABASE_URL) {
    console.log("\n⚠️ DATABASE_URL 미설정 → 저장 스킵 (스크래퍼 검증만). 예시 3건:");
    for (const s of rows.slice(0, 3)) console.log(`  [${s.site}] ${s.text.slice(0, 60)}`);
    return;
  }

  // 이 실행 자체를 collection_runs에 남긴다(pipeline='trend-rising-collect').
  // raw_signals.run_id가 이 값을 가리킨다 — 랭킹 run(trend-rising-popular)과는 별개.
  const runId = await startRun({ pipeline: "trend-rising-collect", geo: "KR", bucketAt: bucket });
  const apiCallLog = results.map((r) => ({ source: r.name, items: r.items.length, error: r.error ?? null }));
  const errored = results.filter((r) => r.error);
  const status = errored.length === 0 ? "success" : errored.length === results.length ? "error" : "partial";

  try {
    const saved = await insertRawItems(rows, runId);
    console.log(`\n💾 raw_signals 저장(신규): ${saved}건`);
    await finishRun(runId, {
      status,
      rawSignalCount: rows.length,
      apiCallLog,
      errorMessage: errored.length ? errored.map((r) => `${r.name}: ${r.error}`).join("; ") : null,
    });
  } catch (err) {
    await finishRun(runId, {
      status: "error",
      apiCallLog,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error("[collect] 오류:", err);
    await closeDb();
    process.exit(1);
  });
