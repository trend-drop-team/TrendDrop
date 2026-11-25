/**
 * 수집 오케스트레이션 — 6소스 중 제외 목록(sources/excluded-sources.mjs)을 뺀 나머지를 병렬 스크래핑해 1시간 버킷으로 raw_signals에 축적.
 * trend-collector src/jobs/collect-sources.ts 에서 이전(SQLite→Postgres).
 *
 * 실행:  node pipeline/collect.mjs
 *   env: YOUTUBE_API_KEY, REGION_CODE (유튜브용), DATABASE_URL (저장용)
 *   DATABASE_URL 없으면 스크랩만 하고 저장은 스킵(스크래퍼 검증용). 단 GitHub Actions에서는 실패로 끝낸다.
 *   소스가 하나라도 실패(오류·0건)하면 받은 데이터는 저장한 뒤 exit 1로 끝낸다(#84).
 */
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { collect as dcbest } from "./sources/dcbest.mjs";
import { collect as theqoo } from "./sources/theqoo.mjs";
import { collect as instiz } from "./sources/instiz.mjs";
import { collect as youtube } from "./sources/youtube.mjs";
import { collect as gtrends } from "./sources/gtrends.mjs";
import { collect as xtrends } from "./sources/xtrends.mjs";
import { activeAdapters } from "./adapters.mjs";
import { EXCLUDED_SOURCES } from "./sources/excluded-sources.mjs";
import { insertRawItems, startRun, finishRun, closeDb } from "./store.mjs";

// 디시·더쿠·인스티즈는 EXCLUDED_SOURCES로 실행에서 뺀다(목록·import는 되돌리기 쉽게 남김).
// 네이트판은 2026-08-03에 제외했다 — 사연·신변잡기 위주라 트렌드 키워드가 거의 안 나왔다.
const ADAPTERS = [
  ["dcbest", dcbest],
  ["theqoo", theqoo],
  ["instiz", instiz],
  ["youtube", youtube],
  ["gtrends", gtrends],
  ["xtrends", xtrends],
];

const sha1 = (s) => createHash("sha1").update(s).digest("hex");

/** 1시간 floor 버킷 (UTC ISO). */
export function hourBucket(d) {
  const x = new Date(d);
  x.setMinutes(0, 0, 0);
  return x.toISOString();
}

/** 소스 하나 이상이 실패한 수집. 받은 데이터를 저장한 뒤 던진다. */
export class CollectFailedError extends Error {
  constructor(failures) {
    super(`수집 실패 소스: ${failures.map((f) => `${f.name}(${f.reason})`).join(", ")}`);
    this.name = "CollectFailedError";
    this.failures = failures;
  }
}

/**
 * 소스별 결과 판정. 오류가 났거나 0건이면 실패다.
 * status: 전부 성공 success / 일부 실패 partial / 전부 실패 error.
 */
export function judgeCollection(results) {
  const failures = results
    .filter((r) => r.error || r.items.length === 0)
    .map((r) => ({ name: r.name, reason: r.error ?? "0건" }));
  const status = failures.length === 0 ? "success" : failures.length === results.length ? "error" : "partial";
  return { status, failures };
}

/** GitHub 워크플로 명령 `::error` 한 줄. 값의 %·개행, 속성의 ,·:을 규칙대로 이스케이프한다. */
export function errorAnnotation(name, reason) {
  const data = (v) => String(v).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const prop = (v) => data(v).replace(/:/g, "%3A").replace(/,/g, "%2C");
  return `::error title=${prop(`collect ${name} 실패`)}::${data(reason)}`;
}

/** Actions에서 DATABASE_URL이 비면 저장을 건너뛰지 않고 실패시킨다. 로컬은 스크래퍼 검증용으로 스킵 허용. */
export function shouldSkipSave(env) {
  if (env.DATABASE_URL) return false;
  if (env.GITHUB_ACTIONS === "true") throw new Error("GitHub Actions에서 DATABASE_URL이 비어 있다 — 시크릿 설정 확인");
  return true;
}

async function runAdapter([name, fn]) {
  try {
    return { name, items: await fn() };
  } catch (err) {
    return { name, items: [], error: (err instanceof Error ? err.message || err.name : String(err)) || "알 수 없는 오류" };
  }
}

async function main() {
  const now = new Date();
  const bucket = hourBucket(now);
  const collectedAt = now.toISOString();
  const kst = now.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

  const active = activeAdapters(ADAPTERS, EXCLUDED_SOURCES);

  console.log(`\n🗂  ${active.length}소스 수집 — 버킷 ${bucket} (${kst} KST)\n`);

  // 저장 불가 상태면 유료 API(X)를 부르기 전에 끝낸다.
  const skipSave = shouldSkipSave(process.env);
  const results = await Promise.all(active.map(runAdapter));

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
        textHash: sha1(JSON.stringify([it.source, it.meta?.videoId ?? null, it.text, it.meta?.newsTitles ?? []])),
        meta: it.meta ?? null,
        bucketAt: bucket,
        capturedAt: collectedAt,
      });
    }
  }
  console.log("─".repeat(28));
  console.log(`총 수집 ${rows.length}건`);

  const { status, failures } = judgeCollection(results);
  // 저장 성공·실패·스킵과 무관하게 Actions 화면에 소스별 실패를 먼저 남긴다.
  for (const f of failures) console.log(errorAnnotation(f.name, f.reason));

  if (skipSave) {
    console.log("\n⚠️ DATABASE_URL 미설정 → 저장 스킵 (스크래퍼 검증만). 예시 3건:");
    for (const s of rows.slice(0, 3)) console.log(`  [${s.site}] ${s.text.slice(0, 60)}`);
    if (failures.length) throw new CollectFailedError(failures);
    return;
  }

  // 이 실행 자체를 collection_runs에 남긴다(pipeline='collect').
  // raw_signals.run_id가 이 값을 가리킨다 — 랭킹 run(popular)과는 별개.
  const runId = await startRun({ pipeline: "collect", geo: "KR", bucketAt: bucket });
  const apiCallLog = results.map((r) => ({ source: r.name, items: r.items.length, error: r.error ?? null }));

  try {
    const saved = await insertRawItems(rows, runId);
    console.log(`\n💾 raw_signals 저장(신규): ${saved}건`);
    await finishRun(runId, {
      status,
      rawSignalCount: rows.length,
      apiCallLog,
      errorMessage: failures.length ? failures.map((f) => `${f.name}: ${f.reason}`).join("; ") : null,
    });
  } catch (err) {
    await finishRun(runId, {
      status: "error",
      apiCallLog,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  // 데이터는 이미 저장됐다. 실패를 exit 1로 드러낸다.
  if (failures.length) throw new CollectFailedError(failures);
}

// 테스트가 hourBucket만 import할 때 수집이 돌지 않게 — 직접 실행(node pipeline/collect.mjs)일 때만 main
const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main()
    .then(() => closeDb())
    .catch(async (err) => {
      console.error("[collect] 오류:", err);
      await closeDb();
      process.exit(1);
    });
}
