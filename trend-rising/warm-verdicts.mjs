/**
 * 판정 캐시 워밍 — 전 기간에 걸쳐 후보에 오른 적 있는 모든 term을 한 번에 판정해
 * keyword_verdicts를 채운다.
 *
 * 이게 있어야 backfill-popular.mjs가 API를 한 번도 호출하지 않고 전 기간을
 * 재생성할 수 있다. 수집/랭킹을 분리한 것과 같은 이유 — 비싼 건 한 번만.
 *
 * 실행:  node trend-rising/warm-verdicts.mjs [--dry] [--limit N]
 *   env: DATABASE_URL, ANTHROPIC_API_KEY(필수), HOURS(기본 6), POOL(기본 50), BATCH(기본 60)
 *   --dry    실제 호출 없이 대상 term 수만 센다
 *   --limit  판정할 최대 term 수 (비용 상한 확인용)
 */
import { loadAllItems, loadVerdicts, saveVerdicts, closeDb } from "./store.mjs";
import { rankPopular } from "./popular.mjs";
import { judgeTerms } from "./verdict.mjs";

const dry = process.argv.includes("--dry");
const limitArg = process.argv.indexOf("--limit");
const maxTerms = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;
const WINDOW_HOURS = Number(process.env.HOURS ?? 6) || 6;
const BATCH = Number(process.env.BATCH ?? 60) || 60;
const HOUR_MS = 3600e3;
const POOL = Number(process.env.POOL ?? 50) || 50;

const rows = await loadAllItems();
const byBucket = new Map();
for (const r of rows) {
  let list = byBucket.get(r.bucketAt);
  if (!list) byBucket.set(r.bucketAt, (list = []));
  list.push(r);
}
const buckets = [...byBucket.keys()].sort();
const bucketMs = buckets.map((b) => Date.parse(b));

// 전 시점을 훑어 후보에 오른 적 있는 term을 모은다. 같은 term은 점수가 가장 높았던
// 시점의 예문을 대표로 쓴다 — 그 단어가 가장 뚜렷하게 드러난 맥락이기 때문.
const best = new Map();
for (let i = 0; i < buckets.length; i++) {
  const cutoff = bucketMs[i] - WINDOW_HOURS * HOUR_MS;
  let start = i;
  while (start > 0 && bucketMs[start - 1] > cutoff) start -= 1;
  const windowRows = buckets.slice(start, i + 1).flatMap((b) => byBucket.get(b));
  const { ranked } = rankPopular(windowRows, { limit: POOL });
  for (const k of ranked) {
    const prev = best.get(k.term);
    if (!prev || k.score > prev.score) best.set(k.term, k);
  }
}

console.log(`\n시점 ${buckets.length}개 × top${POOL} → 고유 term ${best.size}개`);

const cached = await loadVerdicts([...best.keys()]);
let todo = [...best.values()].filter((k) => !cached.has(k.term));
todo.sort((a, b) => b.score - a.score); // 점수 높은 것부터 — --limit을 걸 때 중요한 것부터
console.log(`이미 판정됨 ${cached.size}개 / 판정 필요 ${todo.length}개`);

if (Number.isFinite(maxTerms) && todo.length > maxTerms) {
  console.log(`--limit ${maxTerms} → 상위 ${maxTerms}개만 판정`);
  todo = todo.slice(0, maxTerms);
}

if (dry) {
  console.log(`\n[--dry] 호출 없이 종료. 배치 ${Math.ceil(todo.length / BATCH)}회 예상\n`);
  await closeDb();
  process.exit(0);
}
if (todo.length === 0) {
  console.log("\n판정할 term 없음 — 캐시가 이미 최신\n");
  await closeDb();
  process.exit(0);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("\n❌ ANTHROPIC_API_KEY 미설정\n");
  await closeDb();
  process.exit(1);
}

let done = 0;
let kept = 0;
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  const label = `배치 ${Math.floor(i / BATCH) + 1}/${Math.ceil(todo.length / BATCH)} (${batch.length}개)`;
  try {
    const verdicts = await judgeTerms(batch);
    const sampleOf = new Map(batch.map((k) => [k.term, k.sample]));
    const withSample = verdicts
      .filter((v) => sampleOf.has(v.term))
      .map((v) => ({ ...v, sample: sampleOf.get(v.term) }));
    await saveVerdicts(withSample, process.env.VERDICT_MODEL || "claude-sonnet-5");
    done += withSample.length;
    kept += withSample.filter((v) => v.keep).length;
    const drop = withSample.filter((v) => !v.keep).length;
    console.log(`  ${label} → 저장 ${withSample.length} (유지 ${withSample.length - drop} / 제거 ${drop})`);
  } catch (err) {
    console.error(`  ${label} → ⚠️ 실패: ${err instanceof Error ? err.message : err}`);
  }
}

console.log(`\n💾 판정 저장 ${done}개 (유지 ${kept} / 제거 ${done - kept})`);
console.log(`   이제 backfill-popular.mjs --reset 을 돌리면 API 0회로 전 기간이 재생성된다\n`);
await closeDb();
