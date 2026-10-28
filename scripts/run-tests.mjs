#!/usr/bin/env node
// run-tests — 단위 테스트만 모아 node:test(tsx 경유)로 돌린다.
//   lib/server/app  *.test.ts
//   pipeline        *.test.mjs  (pipeline/experiments/는 제외 — LLM을 부르는 수동 실험이라 회귀 게이트가 아님)
// node --test 기본 탐색은 pipeline/experiments/*-test.mjs 같은 무관한 파일까지 주워서 쓰지 않음.
import { execFileSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TARGETS = [
  { dir: "lib", ext: ".test.ts" },
  { dir: "server", ext: ".test.ts" },
  { dir: "app", ext: ".test.ts" },
  { dir: "pipeline", ext: ".test.mjs", exclude: ["pipeline/experiments"] },
];

function walk(dir, ext, exclude = [], acc = []) {
  if (exclude.includes(dir.split(path.sep).join("/"))) return acc;
  const full = path.join(ROOT, dir);
  if (!existsSync(full)) return acc;
  for (const e of readdirSync(full, { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, ext, exclude, acc);
    else if (rel.endsWith(ext)) acc.push(rel);
  }
  return acc;
}

const files = TARGETS.flatMap((t) => walk(t.dir, t.ext, t.exclude));
if (files.length === 0) {
  console.log("테스트 파일 없음");
  process.exit(0);
}

execFileSync("npx", ["tsx", "--test", ...files], { cwd: ROOT, stdio: "inherit" });
