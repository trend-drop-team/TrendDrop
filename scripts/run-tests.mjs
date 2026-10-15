#!/usr/bin/env node
// run-tests — *.test.ts 파일만 모아 node:test(tsx 경유)로 돌린다.
// node --test 기본 탐색은 pipeline/experiments/*-test.mjs 같은 무관한 파일까지 주워서 쓰지 않음.
import { execFileSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SEARCH_DIRS = ["lib", "server", "app"];

function walk(dir, acc = []) {
  const full = path.join(ROOT, dir);
  if (!existsSync(full)) return acc;
  for (const e of readdirSync(full, { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, acc);
    else if (rel.endsWith(".test.ts")) acc.push(rel);
  }
  return acc;
}

const files = SEARCH_DIRS.flatMap((d) => walk(d));
if (files.length === 0) {
  console.log("테스트 파일(*.test.ts) 없음");
  process.exit(0);
}

execFileSync("npx", ["tsx", "--test", ...files], { cwd: ROOT, stdio: "inherit" });
