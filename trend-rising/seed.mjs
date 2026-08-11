/**
 * 1회 seed — trend-collector에서 export한 스냅샷(11일치)을 raw_signals로 적재.
 * 이후엔 collect.mjs가 매시간 append하므로 이 스크립트는 최초 1번만.
 *
 * 실행:  node trend-rising/seed.mjs [스냅샷경로]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { insertRawItems, closeDb } from "./store.mjs";

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

console.log(`seed 대상 ${rows.length}행 → raw_signals`);
let total = 0;
for (let i = 0; i < rows.length; i += 1000) {
  total += await insertRawItems(rows.slice(i, i + 1000));
  process.stdout.write(`\r적재 ${Math.min(i + 1000, rows.length)}/${rows.length}`);
}
console.log(`\n완료 — 신규 저장 ${total}건`);
await closeDb();
