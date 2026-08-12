#!/usr/bin/env node
/**
 * 004 — trend-rising 자체 테이블(sources/raw_signals/collection_runs/popular_snapshots/
 * keyword_verdicts/keywords)을 걷어내고 db/unified-schema.ts 기준 스키마로 옮긴다.
 *
 * 001~003과 달리 이번엔 ALTER가 아니라 DROP + 재생성이다 — PK 타입(identity)·제약조건
 * 이름 등 구조 자체가 달라져서 무손실 ALTER로는 못 맞춘다.
 *
 * 옮기는 것(재수집 불가·비용 발생분이라 반드시 보존):
 *   sources(5행), raw_signals(원문), keyword_verdicts(LLM 판정)
 * 새로 만드는 것(파생 데이터, backfill로 재생성 — API 0회):
 *   keywords, trend_snapshots
 *
 * raw_signals.run_id가 이제 NOT NULL이라, 과거 raw_signals의 distinct bucket_at마다
 * collection_runs(pipeline='trend-rising-collect') 1건을 합성해서 채운다 — 매시간
 * collect.mjs가 실제로 실행됐다면 남겼을 기록을 사후에 재구성하는 것.
 *
 * 실행:
 *   node trend-rising/migrations/004-adopt-unified-schema.mjs          # 백업 + 계획만 (dry-run)
 *   node trend-rising/migrations/004-adopt-unified-schema.mjs --apply  # 실제 반영
 *
 * 이후: node trend-rising/backfill-popular.mjs --reset (keywords/trend_snapshots 재생성)
 *
 * ── 되돌리기 ──────────────────────────────────────────────────────────────
 * --apply 전 자동으로 trend-rising/.data/pre-unified-backup.json에 sources/raw_signals/
 * keyword_verdicts를 덤프한다. 문제가 생기면:
 *   1) DROP TABLE sources, raw_signals, collection_runs, keywords, trend_snapshots,
 *      trend_contents, keyword_relations, categories, users, watchlist_items,
 *      keyword_verdicts CASCADE;
 *   2) 001/002 마이그레이션이 만들던 옛 스키마(rising_raw_items 등)를 다시 실행
 *   3) 백업 JSON에서 옛 컬럼명으로 재적재
 * (001~003 파일의 ROLLBACK 절 참고)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../..");
const unifiedSql = resolve(projectRoot, "drizzle/unified/0000_certain_tattoo.sql");
const backupPath = resolve(here, "../.data/pre-unified-backup.json");

const apply = process.argv.includes("--apply");

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL 미설정");
  process.exit(1);
}

const { default: postgres } = await import("postgres");
let sql = postgres(process.env.DATABASE_URL, { prepare: false, onnotice: () => {} });

console.log("=== 1) 백업 대상 조회 ===");
const sources = await sql`SELECT * FROM sources ORDER BY id`;
const rawSignals = await sql`SELECT * FROM raw_signals ORDER BY id`;
const verdicts = await sql`SELECT * FROM keyword_verdicts ORDER BY term`;
console.log(
  `sources ${sources.length} / raw_signals ${rawSignals.length} / keyword_verdicts ${verdicts.length}`
);

const buckets = [...new Set(rawSignals.map((r) => new Date(r.bucket_at).toISOString()))].sort();
console.log(`distinct bucket_at ${buckets.length}개 → collect run ${buckets.length}건 합성 예정`);

mkdirSync(dirname(backupPath), { recursive: true });
writeFileSync(backupPath, JSON.stringify({ sources, rawSignals, verdicts }, null, 2));
console.log(`백업 저장: ${backupPath}`);

if (!apply) {
  console.log("\n[dry-run] --apply 없이 종료. 실제 반영하려면 --apply를 붙여서 다시 실행하세요.\n");
  await sql.end();
  process.exit(0);
}

console.log("\n=== 2) 기존 테이블 제거 ===");
await sql`DROP TABLE IF EXISTS popular_snapshots CASCADE`;
await sql`DROP TABLE IF EXISTS raw_signals CASCADE`;
await sql`DROP TABLE IF EXISTS keywords CASCADE`;
await sql`DROP TABLE IF EXISTS keyword_verdicts CASCADE`;
await sql`DROP TABLE IF EXISTS collection_runs CASCADE`;
await sql`DROP TABLE IF EXISTS sources CASCADE`;
console.log("완료");

await sql.end(); // psql로 넘기기 전 커넥션 정리

console.log("\n=== 3) unified 스키마 적용 (drizzle/unified/0000_certain_tattoo.sql) ===");
execFileSync("psql", [process.env.DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-f", unifiedSql], {
  stdio: "inherit",
});
console.log("완료 — 11개 테이블 생성");

sql = postgres(process.env.DATABASE_URL, { prepare: false, onnotice: () => {} });

console.log("\n=== 4) sources 복원 (id 보존) ===");
for (const s of sources) {
  await sql`INSERT INTO sources (id, name, kind, created_at) OVERRIDING SYSTEM VALUE
    VALUES (${s.id}, ${s.name}, ${s.kind}, ${s.created_at})`;
}
await sql`SELECT setval(pg_get_serial_sequence('sources', 'id'), (SELECT max(id) FROM sources))`;
console.log(`sources ${sources.length}행 복원 (id 유지)`);

console.log("\n=== 5) collect run 합성 (버킷당 1건, pipeline='trend-rising-collect') ===");
const runIdByBucket = new Map();
for (const bucketAt of buckets) {
  const rowsInBucket = rawSignals.filter((r) => new Date(r.bucket_at).toISOString() === bucketAt);
  const capturedTimes = rowsInBucket.map((r) => new Date(r.captured_at).getTime());
  const startedAt = new Date(Math.min(...capturedTimes)).toISOString();
  const finishedAt = new Date(Math.max(...capturedTimes)).toISOString();
  const [run] = await sql`INSERT INTO collection_runs
    (pipeline, geo, started_at, finished_at, status, raw_signal_count, bucket_at)
    VALUES ('trend-rising-collect', 'KR', ${startedAt}, ${finishedAt}, 'success',
            ${rowsInBucket.length}, ${bucketAt})
    RETURNING id`;
  runIdByBucket.set(bucketAt, run.id);
}
console.log(`collection_runs ${buckets.length}건 합성`);

console.log("\n=== 6) raw_signals 복원 (run_id 채움) ===");
let restored = 0;
await sql.begin(async (tx) => {
  for (const r of rawSignals) {
    const bucketIso = new Date(r.bucket_at).toISOString();
    const runId = runIdByBucket.get(bucketIso);
    await tx`INSERT INTO raw_signals
      (run_id, source_id, source, text, text_hash, video_id, meta, bucket_at, captured_at)
      VALUES (${runId}, ${r.source_id}, ${r.source}, ${r.text}, ${r.text_hash}, ${r.video_id},
              ${r.meta ? tx.json(r.meta) : null}, ${r.bucket_at}, ${r.captured_at})`;
    restored += 1;
  }
});
console.log(`raw_signals ${restored}행 복원`);

console.log("\n=== 7) keyword_verdicts 복원 ===");
await sql.begin(async (tx) => {
  for (const v of verdicts) {
    await tx`INSERT INTO keyword_verdicts
      (term, keep, canonical, content_type, reason, sample, model, decided_at)
      VALUES (${v.term}, ${v.keep}, ${v.canonical}, ${v.content_type}, ${v.reason}, ${v.sample},
              ${v.model}, ${v.decided_at})`;
  }
});
console.log(`keyword_verdicts ${verdicts.length}행 복원`);

console.log("\n=== 8) 검증 ===");
const [{ count: rsCount }] = await sql`SELECT count(*)::int FROM raw_signals`;
const [{ count: nullRun }] = await sql`SELECT count(*)::int FROM raw_signals WHERE run_id IS NULL`;
const [{ count: kvCount }] = await sql`SELECT count(*)::int FROM keyword_verdicts`;
console.log(`raw_signals ${rsCount}행 (run_id NULL ${nullRun}건) / keyword_verdicts ${kvCount}행`);
if (nullRun > 0) throw new Error("raw_signals에 run_id가 안 채워진 행이 있음 — 되돌리기 절 참고");
if (rsCount !== rawSignals.length) throw new Error(`raw_signals 행수 불일치: ${rsCount} !== ${rawSignals.length}`);
if (kvCount !== verdicts.length) throw new Error(`keyword_verdicts 행수 불일치: ${kvCount} !== ${verdicts.length}`);

console.log("\n✅ 완료. 다음: node trend-rising/backfill-popular.mjs --reset\n");
await sql.end();
