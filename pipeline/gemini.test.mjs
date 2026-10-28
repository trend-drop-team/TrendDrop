/**
 * Gemini 호출 경로 단위 테스트 (#89) — 네트워크 없이 함수 주입과 fetch 모킹으로만 돈다.
 *
 * 2026-10-14 사고 회귀(PIPELINE.md 4장 "실패 처리"): API 키가 무효인데 오류를 삼키고 success로 기록했다.
 * 지금 규칙은 "키 오류(400/401/403)는 삼키지 않고 throw, 그 밖의 실패는 error로 남겨 partial" —
 * rank-popular.mjs의 status 결정(errors.length ? "partial" : "success")에 들어가는 값을 여기서 고정한다.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { withModelFallback, generateJson, EXTRACT_MODELS } from "./gemini.mjs";
import { extractMissing, reviewPool, rankIssues } from "./issues.mjs";

const httpError = (status, message = `HTTP ${status}`) => Object.assign(new Error(message), { status });

/* ── withModelFallback ───────────────────────────────────────────── */

test("withModelFallback: 첫 모델이 답하면 fallbackReason 없음", async () => {
  const tried = [];
  const res = await withModelFallback(async (m) => { tried.push(m); return { ok: m }; }, ["a", "b"]);
  assert.deepEqual(res, { result: { ok: "a" }, model: "a", fallbackReason: null });
  assert.deepEqual(tried, ["a"]);
});

for (const status of [429, 500, 503, undefined]) {
  test(`withModelFallback: ${status ?? "status 없음(타임아웃 등)"}이면 다음 모델로 넘기고 사유를 남긴다`, async () => {
    const tried = [];
    const res = await withModelFallback(async (m) => {
      tried.push(m);
      if (m === "a") throw httpError(status, "과부하");
      return "답";
    }, ["a", "b"]);
    assert.deepEqual(tried, ["a", "b"]);
    assert.equal(res.model, "b");
    assert.equal(res.result, "답");
    assert.match(res.fallbackReason, /^a: 과부하/);
  });
}

for (const status of [400, 401, 403]) {
  test(`withModelFallback: ${status}(키·요청 문제)는 다음 모델을 시도하지 않고 즉시 throw`, async () => {
    const tried = [];
    await assert.rejects(
      withModelFallback(async (m) => { tried.push(m); throw httpError(status); }, ["a", "b", "c"]),
      (err) => err.status === status,
    );
    assert.deepEqual(tried, ["a"]);
  });
}

test("withModelFallback: 401이 두 번째 모델에서 나도 즉시 throw (앞 실패 사유로 덮지 않음)", async () => {
  const tried = [];
  await assert.rejects(
    withModelFallback(async (m) => {
      tried.push(m);
      throw m === "a" ? httpError(503) : httpError(401, "API key not valid");
    }, ["a", "b", "c"]),
    (err) => err.status === 401 && /API key/.test(err.message),
  );
  assert.deepEqual(tried, ["a", "b"]);
});

test("withModelFallback: 전부 실패하면 모델별 사유를 이어 붙여 throw", async () => {
  await assert.rejects(
    withModelFallback(async (m) => { throw httpError(503, `${m} 과부하`); }, ["a", "b"]),
    { message: "a: a 과부하 / b: b 과부하" },
  );
});

/* ── fetch 모킹 ─────────────────────────────────────────────────── */

let realFetch;
let realKey;
let calls;
/** handler(callIndex, model) → { status, body } | result 객체(성공 응답으로 감쌈) */
function mockGemini(handler) {
  globalThis.fetch = async (url) => {
    const model = String(url).match(/models\/([^:]+):/)?.[1];
    const i = calls.length;
    calls.push(model);
    const r = handler(i, model);
    if (r && typeof r.status === "number") {
      return new Response(JSON.stringify(r.body ?? { error: { status: "ERR", message: "mock" } }), { status: r.status });
    }
    const body = { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(r) }] } }] };
    return new Response(JSON.stringify(body), { status: 200 });
  };
}
beforeEach(() => {
  realFetch = globalThis.fetch;
  realKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key-not-real";
  calls = [];
  // 모킹을 빠뜨린 테스트가 실제 네트워크로 나가지 않게
  globalThis.fetch = async () => { throw new Error("테스트에서 실제 fetch 호출 금지"); };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = realKey;
});

/* ── generateJson ───────────────────────────────────────────────── */

test("generateJson: GEMINI_API_KEY가 없으면 fetch 없이 status 401로 throw", async () => {
  delete process.env.GEMINI_API_KEY;
  mockGemini(() => ({}));
  await assert.rejects(generateJson("m", "s", "u", {}), (err) => err.status === 401);
  assert.equal(calls.length, 0);
});

test("generateJson: HTTP 오류는 err.status에 상태 코드를 싣는다 (무효 키 400 API_KEY_INVALID)", async () => {
  mockGemini(() => ({ status: 400, body: { error: { status: "INVALID_ARGUMENT", message: "API key not valid" } } }));
  await assert.rejects(generateJson("m", "s", "u", {}), (err) => err.status === 400 && /API key not valid/.test(err.message));
});

test("generateJson: 정상 응답은 JSON 파싱해 돌려준다", async () => {
  mockGemini(() => ({ items: [1, 2] }));
  assert.deepEqual(await generateJson("m", "s", "u", {}), { items: [1, 2] });
});

test("generateJson: finishReason이 STOP이 아니면 throw (status 없음 → 폴백 대상)", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{" }] } }],
  }), { status: 200 });
  await assert.rejects(generateJson("m", "s", "u", {}), (err) => err.status === undefined && /MAX_TOKENS/.test(err.message));
});

/* ── 검수 과반 투표 reviewPool ──────────────────────────────────── */

const pool = ["A", "B", "C", "D"].map((term, i) => ({ term, score: 10 - i, sample: `${term} 원문` }));
const info = () => ({ category: "인물", issues: [], texts: 1 });

test("reviewPool: 3표 중 2표 이상인 drop·merge만 적용하고 1표짜리는 버린다", async () => {
  const answers = [
    { drop: [{ name: "C", reason: "일반어" }, { name: "D", reason: "1표" }], merge: [{ names: ["A", "B"], into: "A" }] },
    { drop: [{ name: "C", reason: "일반어2" }], merge: [] },
    { drop: [], merge: [{ names: ["B"], into: "A" }] },
  ];
  mockGemini((i) => answers[i]);
  const r = await reviewPool(pool, info, { votes: 3, models: ["m1"] });
  assert.deepEqual([...r.drop], [["C", "일반어"]]); // 사유는 처음 표의 것
  assert.deepEqual(r.merge, [["B", "A"]]);
  assert.equal(r.votes, "3/3");
  assert.equal(r.model, "m1");
});

test("reviewPool: 목록에 없는 이름(지어낸 이름)은 표로 세지 않는다", async () => {
  mockGemini(() => ({ drop: [{ name: "없는이름", reason: "x" }], merge: [{ names: ["A", "가짜"], into: "A" }, { names: ["B"], into: "가짜2" }] }));
  const r = await reviewPool(pool, info, { votes: 3, models: ["m1"] });
  assert.equal(r.drop.size, 0);
  assert.deepEqual(r.merge, []);
});

test("reviewPool: 한 응답 안에서 같은 쌍을 두 번 말해도 1표", async () => {
  const answers = [
    { drop: [], merge: [{ names: ["A", "B"], into: "A" }, { names: ["B", "A"], into: "A" }] },
    { drop: [], merge: [] },
    { drop: [], merge: [] },
  ];
  mockGemini((i) => answers[i]);
  const r = await reviewPool(pool, info, { votes: 3, models: ["m1"] });
  assert.deepEqual(r.merge, []);
});

test("reviewPool: 병합 방향은 표가 많은 정식 이름, 한쪽이 drop이면 병합 안 함", async () => {
  const answers = [
    { drop: [{ name: "D", reason: "x" }], merge: [{ names: ["A", "B"], into: "B" }, { names: ["C", "D"], into: "C" }] },
    { drop: [{ name: "D", reason: "x" }], merge: [{ names: ["A", "B"], into: "B" }, { names: ["C", "D"], into: "C" }] },
    { drop: [], merge: [{ names: ["A", "B"], into: "A" }] },
  ];
  mockGemini((i) => answers[i]);
  const r = await reviewPool(pool, info, { votes: 3, models: ["m1"] });
  assert.deepEqual(r.merge, [["A", "B"]]);
  assert.ok(r.drop.has("D"));
});

test("reviewPool: 과반은 성공한 응답 수 기준 (3표 중 1표 실패 → 2표 중 2표 필요)", async () => {
  const answers = [
    { status: 503 },
    { drop: [{ name: "C", reason: "x" }], merge: [] },
    { drop: [{ name: "C", reason: "x" }, { name: "D", reason: "x" }], merge: [] },
  ];
  mockGemini((i) => answers[i]);
  const r = await reviewPool(pool, info, { votes: 3, models: ["m1"] });
  assert.equal(r.votes, "2/3");
  assert.deepEqual([...r.drop.keys()], ["C"]);
});

test("reviewPool: 전부 401이면 status를 살린 채 throw (키 오류는 검수 실패로 삼키지 않음)", async () => {
  mockGemini(() => ({ status: 401 }));
  await assert.rejects(reviewPool(pool, info, { votes: 3, models: ["m1", "m2"] }), (err) => err.status === 401);
  assert.deepEqual(calls, ["m1", "m1", "m1"]); // 다음 모델로 안 넘어감
});

/* ── 2026-10-14 사고 회귀: 키 오류는 success로 묻히지 않는다 ─────────── */

const T = "2026-10-20T10:00:00.000Z";
const rows = [
  { site: "gtrends", kind: "title", text: "홍길동", textHash: "g1", bucketAt: T },
  { site: "gtrends", kind: "title", text: "임꺽정", textHash: "g2", bucketAt: T },
];

test("사고 회귀: extractMissing — 무효 키(400)는 삼키지 않고 throw, 다음 모델도 안 부른다", async () => {
  mockGemini(() => ({ status: 400, body: { error: { status: "INVALID_ARGUMENT", message: "API key not valid" } } }));
  await assert.rejects(extractMissing(rows, new Map(), new Map()), (err) => err.status === 400);
  assert.equal(calls.length, 1);
});

test("사고 회귀: extractMissing — GEMINI_API_KEY 없음도 throw", async () => {
  delete process.env.GEMINI_API_KEY;
  await assert.rejects(extractMissing(rows, new Map(), new Map()), (err) => err.status === 401);
});

test("extractMissing — 모든 모델 503이면 throw 대신 error·skipped를 남긴다 (→ partial)", async () => {
  mockGemini(() => ({ status: 503 }));
  const ext = new Map();
  const stats = await extractMissing(rows, ext, new Map());
  assert.equal(calls.length, EXTRACT_MODELS.length);
  assert.match(stats.error, /^추출 실패/);
  assert.equal(stats.skipped, 2);
  assert.equal(stats.extracted, 0);
  assert.equal(ext.size, 0); // 저장 안 함 → 다음 실행이 다시 뽑는다
});

test("extractMissing — 정상 응답은 cleanItem을 거쳐 캐시에 채우고 error 없음", async () => {
  mockGemini(() => ({ items: [
    { id: 1, timeliness: "now", keywords: [{ name: "홍길동", surface: "홍길동", category: "인물", issue: null }] },
    // id 2는 모델이 빠뜨림 → 저장 안 함
  ] }));
  const ext = new Map();
  const stats = await extractMissing(rows, ext, new Map());
  assert.equal(stats.error, null);
  assert.equal(stats.extracted, 1);
  assert.deepEqual(ext.get("g1").keywords.map((k) => k.name), ["홍길동"]);
  assert.equal(ext.has("g2"), false);
});

const extracted = () => new Map([
  ["g1", { timeliness: "now", keywords: [{ name: "홍길동", category: "인물", issue: null }] }],
  ["g2", { timeliness: "now", keywords: [{ name: "임꺽정", category: "인물", issue: null }] }],
]);

test("사고 회귀: rankIssues — 검수가 401이면 review.error로 삼키지 않고 throw", async () => {
  mockGemini(() => ({ status: 401 }));
  await assert.rejects(rankIssues(rows, extracted(), new Map()), (err) => err.status === 401);
});

test("rankIssues — 검수가 503으로 전부 실패하면 순위는 내고 review.error를 남긴다 (→ partial)", async () => {
  mockGemini(() => ({ status: 503 }));
  const { ranked, review } = await rankIssues(rows, extracted(), new Map());
  assert.match(review.error, /^검수 실패/);
  assert.deepEqual(ranked.map((k) => k.term).sort(), ["임꺽정", "홍길동"]);
});

test("rankIssues — 검수 과반 merge는 이름 사전에 들어가고 재집계에 합쳐진다", async () => {
  mockGemini(() => ({ drop: [], merge: [{ names: ["임꺽정", "홍길동"], into: "홍길동" }] }));
  const aliases = new Map();
  const { ranked, review } = await rankIssues(rows, extracted(), aliases);
  assert.equal(review.error, null);
  assert.equal(aliases.get("임꺽정"), "홍길동");
  assert.deepEqual(ranked.map((k) => [k.term, k.mentions]), [["홍길동", 2]]);
});
