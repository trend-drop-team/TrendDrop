/** DB의 최근 6시간 → 새 원문 추출 1회 → 별칭 연결 1회 → 통합 Top10. */
import { loadRecentItems, loadExtractions, saveExtractions, startRun, finishRun, saveTrendSnapshots, findRankedRun, closeDb } from "./store.mjs";
import { eligibleRows, extractNew, candidatesOf, linkCandidates, scoreCandidates, cacheVersion, rankSkipReason, PROFILE } from "./trend-ranking.mjs";

import { generateJson, generateJsonWithRetry } from "./claude.mjs";

const calls = [];
const recordAttempt = async (model, system, user, schema) => {
  if (calls.length >= 4) throw new Error("이번 실행의 Claude 요청 상한 4회에 도달했습니다.");
  const stage = schema.properties.groups ? "link" : "extract";
  const attempt = calls.filter((call) => call.stage === stage).length + 1;
  const call = { stage, attempt, model, status: "running" };
  console.log(`[Claude] ${stage}: attempt ${attempt}, model ${model}`);
  calls.push(call);
  try {
    const result = await generateJson(model, system, user, schema, { onUsage: (usage) => { call.usage = usage; } });
    call.status = "success";
    return result;
  } catch (error) {
    call.status = "error";
    call.error = error.message;
    call.httpStatus = error.status ?? null;
    throw error;
  }
};

const generate = (model, system, user, schema) =>
  generateJsonWithRetry(model, system, user, schema, { generate: recordAttempt });

const save = process.argv.includes("--save");
const hours = Number(process.env.HOURS ?? 6);
const topN = Number(process.env.TOP_N ?? 10);
if (!Number.isInteger(hours) || hours < 1 || !Number.isInteger(topN) || topN < 1) throw new Error("HOURS와 TOP_N은 양의 정수여야 합니다.");
if (process.argv.some((arg) => ["--general", "--culture", "--no-review"].includes(arg))) throw new Error("기존 랭킹 프로필 옵션은 더 이상 지원하지 않습니다.");
let runId;

/** 한 버킷의 추출 → 별칭 연결 → 점수 → (저장). */
async function rank(rows, bucketAt) {
  if (save) runId = await startRun({ pipeline: "popular", bucketAt, windowHours: hours, buckets: new Set(rows.map((r) => r.bucketAt)).size });
  const cache = await loadExtractions([...new Set(rows.filter((r) => r.site !== "xtrends").map((r) => r.textHash))], cacheVersion());
  const extraction = await extractNew(rows, cache, { generate });
  if (save) await saveExtractions(extraction.entries, cacheVersion());
  const candidates = candidatesOf(rows, cache);
  const links = await linkCandidates(candidates, { generate });
  // 결함 그룹은 연결하지 않고(각자 점수) 원문 그룹을 경고로 남긴다 — 원인 추적용.
  for (const { group, reason } of links.dropped.slice(0, 10)) {
    const shown = String(JSON.stringify(group)).slice(0, 200).replace(/%/g, "%25");
    console.log(`::warning title=별칭 연결 그룹 버림::${reason} ${shown}`);
  }
  const ranked = scoreCandidates(candidates, links.groups, { windowHours: hours, topN });
  console.log(JSON.stringify({ bucketAt, calls, windowHours: hours, extraction: { ...extraction, entries: undefined }, links, candidates: candidates.length, ranked }, null, 2));
  if (save) {
    await saveTrendSnapshots(runId, bucketAt, ranked, { rankingProfile: PROFILE });
    const notes = [
      extraction.deferred ? `호출 상한으로 신규 원문 ${extraction.deferred}개 다음 회차 대기` : null,
      links.dropped.length ? `별칭 연결 결함 그룹 ${links.dropped.length}개 버림(연결 없이 각자 점수)` : null,
    ].filter(Boolean);
    await finishRun(runId, { status: notes.length ? "partial" : "success", rawSignalCount: rows.length, keywordCount: ranked.length, filtered: false,
      apiCallLog: { provider: "anthropic", rankingProfile: PROFILE, calls, extraction: { ...extraction, entries: undefined }, links },
      errorMessage: notes.length ? notes.join("; ") : null });
  }
}

try {
  const rows = eligibleRows(await loadRecentItems(hours));
  if (!rows.length) throw new Error("수집 데이터가 없습니다.");
  const bucketAt = rows.at(-1).bucketAt;
  // 버킷 하나당 랭킹 1회 — collect 실패·수동 재실행으로 같은 버킷을 또 저장하지 않는다(#91).
  const skip = save ? rankSkipReason(bucketAt, await findRankedRun(bucketAt)) : null;
  if (skip) console.log(`::warning title=rank 건너뜀::${skip}`);
  else await rank(rows, bucketAt);
} catch (error) {
  if (runId) await finishRun(runId, { status: "error", apiCallLog: { provider: "anthropic", rankingProfile: PROFILE, calls }, errorMessage: error.message });
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await closeDb();
}
