/**
 * 1회 seed — trend-collector에서 export한 스냅샷(11일치)을 raw_signals로 적재.
 * 이후엔 collect.mjs가 매시간 append하므로 이 스크립트는 최초 1번만.
 *
 * raw_signals.run_id가 NOT NULL이라, 스냅샷을 bucket_at별로 묶어 버킷마다
 * collect run(pipeline='trend-rising-collect') 1건을 합성한다 — 004 마이그레이션과 같은 방식.
 *
 * 실행: node trend-rising/seed.mjs [스냅샷경로]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { insertRawItems, startRun, finishRun, closeDb } from "./store.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const snapshotPath = process.argv[2] ?? resolve(here, ".data/raw-items-snapshot.json");
const sha1 = (s) => createHash("sha1").update(s).digest("hex");

const raw = JSON.parse(readFileSync(snapshotPath, "utf8"));
const rows = raw.map((r) => {
  let meta = null;
  if (r.meta) {
    try {
      meta = typeof r.meta === "string" ? JSON.parse(r.meta) : r.meta;
    } catch {}
  }
  const bucketAt = r.bucket_at ?? r.bucketAt;
  return {
    site: r.source,
    kind: r.unit ?? "title",
    text: r.text,
    textHash: sha1(r.text),
    meta,
    bucketAt,
    capturedAt: bucketAt,
  };
});

// 버킷별로 묶어 버킷마다 collect run 1건을 만든다.
const byBucket = new Map();
for (const r of rows) {
  let list = byBucket.get(r.bucketAt);
  if (!list) byBucket.set(r.bucketAt, (list = []));
  list.push(r);
}

console.log(`seed 대상 ${rows.length}행 (버킷 ${byBucket.size}개) → raw_signals`);
let total = 0;
let done = 0;
for (const [bucketAt, bucketRows] of byBucket) {
  const runId = await startRun({ pipeline: "trend-rising-collect", geo: "KR", bucketAt });
  try {
    let saved = 0;
    for (let j = 0; j < bucketRows.length; j += 1000) {
      saved += await insertRawItems(bucketRows.slice(j, j + 1000), runId);
    }
    await finishRun(runId, { status: "success", rawSignalCount: bucketRows.length });
    total += saved;
  } catch (err) {
    await finishRun(runId, { status: "error", errorMessage: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  done += 1;
  process.stdout.write(`\r적재 버킷 ${done}/${byBucket.size} (누적 신규 ${total}행)`);
}
console.log(`\n완료 — 신규 저장 ${total}건`);
await closeDb();
