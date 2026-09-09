#!/usr/bin/env node
/*
  verify-ui — TrendDrop UI 품질 게이트 한 방 검사.
  이번 프로젝트에서 매 작업마다 손으로 돌리던 검증을 코드화한 것.

  하드 게이트(하나라도 실패하면 exit 1):
    1. tsc --noEmit
    2. eslint
    3. next build
    4. className 커버리지 — 마크업이 쓰는 클래스가 CSS에 전부 정의됐는지
  소프트 체크(경고만, exit 코드에 영향 없음):
    5. 렌더 순수성 — 우리 소스에 Math.random/Date.now/new Date 있는지(하이드레이션 리스크)
    6. 보호 경로 변경 — 팀 소유 파일이 diff에 잡혔는지
  마지막에 항상: next build가 만든 next-env.d.ts / tsconfig.json drift 되돌림.

  사용: node scripts/verify-ui.mjs   (또는 npm run verify:ui)
*/
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CSS_GLOBS = ["app", "components"]; // 여기서 *.css 를 수집
const TSX_DIRS = ["app", "components"];
// className 커버리지 예외 — 부모/코-클래스로 스타일되는 순수 마크업 훅.
const MARKUP_ONLY = new Set([
  "app-tab-label",
  "docs-panel-heading",
  "watchlist-panel",
]);
// 팀 소유(우리가 건드리면 안 되는) 경로. 변경되면 경고.
// 구 수집 파이프라인(lib/*-collector.ts, trend-pipeline, trends-service, pipeline-v-he 등)은
// 통합 스키마 컷오버 때 제거됨 — 백엔드는 db/schema.ts 기준으로 재작성 예정.
// api-lab·collection-log*는 그 컷오버로 백킹 API가 사라져 함께 제거됨(빌드 복구).
const PROTECTED = [
  "app/api",
  "components",
  "db",
];
// 렌더 순수성 스캔에서 제외할 경로(서버 전용/팀 파일 등은 new Date 등이 정당).
const PURITY_SKIP = [...PROTECTED, "app/api", "lib/env.ts", "lib/docs.ts"];

const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", d: "\x1b[2m", x: "\x1b[0m" };
let hardFail = false;

function walk(dir, exts, acc = []) {
  const full = path.join(ROOT, dir);
  if (!existsSync(full)) return acc;
  for (const e of readdirSync(full, { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, exts, acc);
    else if (exts.some((x) => rel.endsWith(x))) acc.push(rel);
  }
  return acc;
}

function run(label, cmd) {
  process.stdout.write(`  ${label.padEnd(16)} `);
  try {
    execSync(cmd, { cwd: ROOT, stdio: "pipe" });
    console.log(`${C.g}✓${C.x}`);
    return true;
  } catch (err) {
    console.log(`${C.r}✗${C.x}`);
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim().split("\n").slice(-12).join("\n");
    if (out) console.log(out.split("\n").map((l) => `      ${C.d}${l}${C.x}`).join("\n"));
    hardFail = true;
    return false;
  }
}

console.log(`\n${C.d}verify-ui — TrendDrop 품질 게이트${C.x}\n`);

console.log("하드 게이트");
run("tsc", "npx tsc --noEmit");
run("lint", "npm run lint");
run("build", "npm run build");

// 4) className 커버리지
process.stdout.write("  className 커버   ");
{
  const css = walk("app", [".css"]).concat(walk("components", [".css"]))
    .map((f) => readFileSync(path.join(ROOT, f), "utf8")).join("\n");
  const defined = new Set([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]));
  const used = new Map();
  for (const f of TSX_DIRS.flatMap((d) => walk(d, [".tsx"]))) {
    const s = readFileSync(path.join(ROOT, f), "utf8");
    for (const m of s.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const raw = (m[1] || m[2] || "").replace(/\$\{[^}]*\}/g, " ");
      for (const t of raw.split(/\s+/)) {
        if (t && /^[A-Za-z][\w-]*$/.test(t) && !t.endsWith("-")) { // 끝이 '-'면 템플릿 접두사 잔재
          if (!used.has(t)) used.set(t, f);
        }
      }
    }
  }
  const missing = [...used.keys()].filter((c) => !defined.has(c) && !MARKUP_ONLY.has(c));
  if (missing.length === 0) console.log(`${C.g}✓${C.x} ${C.d}(정의 ${defined.size})${C.x}`);
  else {
    console.log(`${C.r}✗${C.x}`);
    for (const c of missing.sort()) console.log(`      ${C.r}.${c}${C.x} ${C.d}<- ${used.get(c)}${C.x}`);
    hardFail = true;
  }
}

console.log("\n소프트 체크");

// 5) 렌더 순수성
process.stdout.write("  렌더 순수성   ");
{
  const hits = [];
  const files = TSX_DIRS.flatMap((d) => walk(d, [".tsx", ".ts"]))
    .filter((f) => !PURITY_SKIP.some((p) => f === p || f.startsWith(p + "/")));
  for (const f of files) {
    const s = readFileSync(path.join(ROOT, f), "utf8");
    s.split("\n").forEach((line, i) => {
      if (/\b(Math\.random|Date\.now|new Date)\b/.test(line) && !/verify-ui-allow/.test(line))
        hits.push(`${f}:${i + 1}`);
    });
  }
  if (hits.length === 0) console.log(`${C.g}✓${C.x}`);
  else {
    console.log(`${C.y}⚠ ${hits.length}${C.x} ${C.d}(하이드레이션 리스크 — 렌더 중이면 useEffect로)${C.x}`);
    for (const h of hits) console.log(`      ${C.y}${h}${C.x}`);
  }
}

// 6) 보호 경로 변경
process.stdout.write("  보호 경로    ");
try {
  const changed = execSync(`git diff --name-only HEAD -- ${PROTECTED.join(" ")}`, { cwd: ROOT })
    .toString().trim().split("\n").filter(Boolean);
  if (changed.length === 0) console.log(`${C.g}✓${C.x} ${C.d}(팀 파일 무수정)${C.x}`);
  else {
    console.log(`${C.y}⚠ ${changed.length}${C.x} ${C.d}(팀 소유 파일 변경됨 — 의도한 게 맞는지 확인)${C.x}`);
    for (const f of changed) console.log(`      ${C.y}${f}${C.x}`);
  }
} catch {
  console.log(`${C.d}skip (git 아님)${C.x}`);
}

// 마무리: next build가 만든 drift 되돌림
try {
  execSync("git checkout -- next-env.d.ts tsconfig.json", { cwd: ROOT, stdio: "ignore" });
} catch { /* 무시 */ }

console.log(
  `\n${hardFail ? `${C.r}✗ 하드 게이트 실패${C.x}` : `${C.g}✓ 하드 게이트 통과${C.x}`}\n`
);
process.exit(hardFail ? 1 : 0);
