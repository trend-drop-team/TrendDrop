#!/usr/bin/env node
/*
  verify-migrations — drizzle 마이그레이션 정합성 게이트.

  2026-09-10에 실제로 터진 사고를 코드화한 것이다:
  drizzle/0001_add_rising_score.sql 파일은 master에 들어와 있었는데
  drizzle이 실제로 읽는 인덱스(meta/_journal.json)에는 등록되지 않아서
  npm run db:migrate가 그 파일을 영원히 건너뛰고 있었다.
  파일만 보면 멀쩡해 보여서 리뷰에서 잡히지 않는 종류의 문제라 검사로 못박는다.

  하드 게이트(하나라도 실패하면 exit 1):
    1. drizzle/*.sql ↔ journal entry 1:1 — 등록 안 된 SQL / 파일 없는 entry
    2. journal entry마다 meta/{tag앞4자리}_snapshot.json 존재
    3. 스냅샷 prevId 체인이 0000부터 끊기지 않고 이어짐
    4. journal idx가 0부터 빠짐없이 연속

  사용: node scripts/verify-migrations.mjs   (또는 npm run verify:migrations)
*/
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "drizzle");
const META = path.join(DIR, "meta");
const JOURNAL = path.join(META, "_journal.json");
const ZERO_ID = "00000000-0000-0000-0000-000000000000";

const fail = [];
const ok = [];

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`${path.relative(ROOT, file)} 를 읽지 못했다: ${err.message}`);
  }
}

if (!existsSync(JOURNAL)) {
  console.error(`✗ ${path.relative(ROOT, JOURNAL)} 가 없다. drizzle 마이그레이션이 초기화되지 않았다.`);
  process.exit(1);
}

const journal = readJson(JOURNAL);
const entries = Array.isArray(journal.entries) ? journal.entries : [];

// --- 1. SQL 파일 ↔ journal entry 1:1 -----------------------------------------
const sqlTags = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.replace(/\.sql$/, ""))
  .sort();
const journalTags = entries.map((e) => e.tag);

const unregistered = sqlTags.filter((t) => !journalTags.includes(t));
const missingFile = journalTags.filter((t) => !sqlTags.includes(t));

if (unregistered.length) {
  fail.push(
    `journal에 등록되지 않은 마이그레이션: ${unregistered.join(", ")}\n` +
      `    → migrate가 이 파일들을 절대 실행하지 않는다. db:generate로 다시 만들거나 entry를 추가할 것.`,
  );
} else {
  ok.push(`SQL ${sqlTags.length}개가 모두 journal에 등록됨`);
}
if (missingFile.length) {
  fail.push(`journal에는 있는데 .sql 파일이 없는 entry: ${missingFile.join(", ")}`);
}

// --- 2. entry마다 스냅샷 존재 --------------------------------------------------
const snapshotFor = (tag) => path.join(META, `${tag.slice(0, 4)}_snapshot.json`);
const noSnapshot = journalTags.filter((t) => !existsSync(snapshotFor(t)));
if (noSnapshot.length) {
  fail.push(
    `스냅샷이 없는 마이그레이션: ${noSnapshot.join(", ")}\n` +
      `    → 다음 db:generate가 낡은 스냅샷과 비교해서 같은 변경을 또 만들어낸다(중복 마이그레이션).`,
  );
} else if (journalTags.length) {
  ok.push(`스냅샷 ${journalTags.length}개 존재`);
}

// --- 3. prevId 체인 ------------------------------------------------------------
if (!noSnapshot.length && journalTags.length) {
  const sorted = [...entries].sort((a, b) => a.idx - b.idx);
  let prev = ZERO_ID;
  let broken = false;
  for (const entry of sorted) {
    const snap = readJson(snapshotFor(entry.tag));
    if (snap.prevId !== prev) {
      fail.push(
        `스냅샷 체인이 끊겼다 — ${entry.tag}.prevId=${snap.prevId} 인데 직전 스냅샷 id는 ${prev} 다.`,
      );
      broken = true;
      break;
    }
    prev = snap.id;
  }
  if (!broken) ok.push(`스냅샷 prevId 체인 ${sorted.length}단계 연결됨`);
}

// --- 4. idx 연속성 -------------------------------------------------------------
const idxs = entries.map((e) => e.idx).sort((a, b) => a - b);
const gap = idxs.findIndex((v, i) => v !== i);
if (gap !== -1) {
  fail.push(`journal idx가 연속이 아니다: ${idxs.join(", ")} (${gap}번째에서 어긋남)`);
} else if (idxs.length) {
  ok.push(`journal idx 0..${idxs.length - 1} 연속`);
}

// --- 결과 ----------------------------------------------------------------------
for (const line of ok) console.log(`✓ ${line}`);
if (fail.length) {
  console.error("");
  for (const line of fail) console.error(`✗ ${line}`);
  console.error(`\n마이그레이션 정합성 검사 실패 — ${fail.length}건`);
  process.exit(1);
}
console.log("\n마이그레이션 정합성 이상 없음");
