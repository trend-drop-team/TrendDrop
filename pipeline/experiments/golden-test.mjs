/**
 * [실험] 정답 세트 채점 — 이슈 추출 프롬프트를 golden-cases.mjs로 채점한다. DB 미사용.
 *
 * 실행:  node --env-file=.env.local pipeline/experiments/golden-test.mjs [모델 ...]
 *   모델을 안 주면 gemini.mjs의 EXTRACT_MODELS 순서대로 시도(운영 추출과 같은 모델).
 *   여러 개를 주면 각 모델로 따로 채점해 비교한다.
 */
import { generateJson, withModelFallback, EXTRACT_MODELS } from "../gemini.mjs";
import { SYSTEM, SCHEMA, PROMPT_VERSION, formatLine, buildUserMessage } from "../issue-prompt.mjs";
import { CASES as BASE, VIDEOS, LITERAL_CASES } from "./golden-cases.mjs";
import { cleanItem } from "../issues.mjs";

const videoTitles = new Map(VIDEOS.map((v) => [v.meta.videoId, v.text]));
// 운영과 똑같이 모델 답에 코드 검증(cleanItem — 원문에 없는 이름 버리기, 직함 → 현직자)까지 거쳐 채점한다
const SETS = [{ label: "코드 검증 후", cases: [...BASE, ...LITERAL_CASES] }];
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

function grade(expect, names) {
  if (expect.empty) return names.length === 0 ? null : "키워드가 없어야 함";
  if (expect.nonEmpty && names.length === 0) return "키워드가 있어야 함";
  if (expect.names) {
    const want = [...expect.names].sort().join("|");
    if ([...names].sort().join("|") !== want) return `정확히 [${expect.names.join(", ")}]이어야 함`;
  }
  if (expect.has && !names.some((n) => n.includes(expect.has))) return `'${expect.has}' 포함 키워드 필요`;
  if (expect.not?.some((n) => names.includes(n))) return `[${expect.not.join(", ")}]는 나오면 안 됨`;
  if (expect.notHas && names.some((n) => n.includes(expect.notHas))) return `'${expect.notHas}' 포함 키워드는 안 됨`;
  if (expect.normHas && !names.some((n) => norm(n).includes(expect.normHas))) return `'${expect.normHas}'(대소문자·공백 무시) 포함 키워드 필요`;
  return null;
}

async function run(models) {
  for (const set of SETS) {
    const CASES = set.cases;
    const lines = CASES.map((c, i) => formatLine(i + 1, c.row, videoTitles));
    const user = buildUserMessage(lines);
    const t = Date.now();
    const { result, model } = await withModelFallback((m) => generateJson(m, SYSTEM, user, SCHEMA), models);
    const byId = new Map((result.items ?? []).map((it) => [it.id, it]));
    let pass = 0;
    const fails = [];
    CASES.forEach((c, i) => {
      const item = byId.get(i + 1);
      const kws = item ? cleanItem(item, c.row).keywords : [];
      const names = kws.map((k) => k.name.trim());
      let why = grade(c.expect, names);
      if (!why && c.expect.category && kws.some((k) => k.category !== c.expect.category)) {
        why = `카테고리는 ${c.expect.category}이어야 함 (${kws.map((k) => k.category).join(", ")})`;
      }
      if (!why && c.expect.group) {
        // 같은 group의 첫 사례와 키워드가 같아야 한다
        const first = CASES.findIndex((o) => o.expect.group === c.expect.group);
        const fi = byId.get(first + 1);
        const firstNames = (fi ? cleanItem(fi, CASES[first].row).keywords : []).map((k) => k.name.trim());
        if (firstNames.sort().join("|") !== [...names].sort().join("|")) why = `같은 사건인데 이름이 다름 (첫 사례: [${firstNames.join(", ")}])`;
      }
      if (why) fails.push(`  ✗ ${c.row.text.slice(0, 44).padEnd(44)} → [${names.join(", ")}]  ${why}`);
      else pass += 1;
    });
    console.log(`\n${PROMPT_VERSION} · ${model} · ${set.label} (${((Date.now() - t) / 1000).toFixed(0)}초): ${pass}/${CASES.length} 통과`);
    for (const f of fails) console.log(f);
  }
}

const args = process.argv.slice(2);
if (args.length === 0) await run(EXTRACT_MODELS);
for (const m of args) {
  try {
    await run([m]);
  } catch (err) {
    console.log(`\n${m}: 호출 실패 — ${String(err.message).slice(0, 100)}`);
  }
}
