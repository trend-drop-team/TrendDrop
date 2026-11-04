import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEditorial, editDiscovery, projectEditorial, EDITOR_MODELS } from "./discovery-editor.mjs";
import { rankIssues, extractMissing } from "./issues.mjs";
import { canonicalTerm } from "./canonical-term.mjs";
import { buildEvidencePackets } from "./evidence-packets.mjs";
import { extractionCacheVersion } from "./discovery-prompt.mjs";

test("추출 모델 비교에서 다른 모델의 캐시를 재사용하지 않는다", () => {
  assert.notEqual(extractionCacheVersion(["lite"]), extractionCacheVersion(["flash"]));
  assert.equal(extractionCacheVersion(["lite"]), extractionCacheVersion(["lite"]));
  assert.ok(extractionCacheVersion(["a-very-long-model-name"]).length <= 40);
});

const packet = { id: 1, term: "하겐다즈", evidence: [{ id: "cake", text: "하겐다즈 돌케이크 자르기" }] };
const keep = { id: 1, action: "keep", displayName: "돌케이크", parentEntity: "하겐다즈", phenomenon: "돌케이크 자르기", kind: "product", domain: "food", evidenceIds: ["cake"], reason: "원문에 있는 구체적인 상품", exclusionReason: "none" };

test("상위 모델의 한도·과부하 실패 시 다음 모델을 거쳐 Lite로 대체한다", async () => {
  assert.deepEqual(EDITOR_MODELS, ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"]);
  const calls = [];
  const result = await editDiscovery([packet], { generate: async (model) => {
    calls.push(model);
    if (model === "gemini-3.5-flash-lite") return { decisions: [keep] };
    throw Object.assign(new Error("일시적 사용 불가"), { status: model === "gemini-3.7-flash" ? 503 : 429 });
  } });
  assert.deepEqual(calls, EDITOR_MODELS);
  assert.equal(result.model, "gemini-3.5-flash-lite");
  assert.match(result.fallbackReason, /gemini-3.8-flash/);
});

test("첫 편집 모델이 성공하면 다른 모델을 호출하지 않는다", async () => {
  const calls = [];
  const result = await editDiscovery([packet], { models: ["first", "second"], generate: async (model) => {
    calls.push(model);
    return { decisions: [keep] };
  } });
  assert.deepEqual(calls, ["first"]);
  assert.equal(result.model, "first");
});

test("의미 불명과 관측 부재를 구분하고 실제 제외 근거는 유지한다", () => {
  const observed = { id: 1, term: "낯선표현", signals: { discovery: { trendBuckets: 4 } }, evidence: [{ id: "trend", site: "xtrends", trendRank: 13, text: "낯선표현" }] };
  const unknown = { ...keep, action: "drop", kind: "unknown", displayName: "", parentEntity: "", phenomenon: "", evidenceIds: [], exclusionReason: "meaning_unknown" };
  const [decision] = validateEditorial({ decisions: [unknown] }, [observed]);
  assert.equal(decision.action, "keep");
  assert.equal(decision.kind, "unknown");
  assert.equal(decision.displayName, "낯선표현");
  assert.equal(decision.meaningUnresolved, true);
  assert.equal(decision.phenomenon, "");
  assert.equal(validateEditorial({ decisions: [{ ...unknown, exclusionReason: "advertising" }] }, [observed])[0].action, "drop");
  const weak = { ...observed, signals: { discovery: { trendBuckets: 1 } } };
  assert.equal(validateEditorial({ decisions: [unknown] }, [weak])[0].action, "drop");
});

test("반복 관측된 낯선 트렌드는 의미를 몰라도 랭킹 경로에서 보존한다", async () => {
  const rows = ["두더지상", "처음듣는표현"].flatMap((text) => ["09", "10", "11", "12"].map((hour) => ({
    site: "xtrends", kind: "title", text, textHash: text, meta: { rank: 13 }, bucketAt: `2026-11-04T${hour}:00:00Z`,
  })));
  const cache = new Map(["두더지상", "처음듣는표현"].map((name) => [name, { timeliness: "buzz", keywords: [{ name, category: "유행어·밈" }] }]));
  const result = await rankIssues(rows, cache, new Map(), { profile: "discovery", editorial: { models: ["offline"], generate: async (model, system, user) => ({
    decisions: JSON.parse(user).candidates.map((candidate) => ({ ...keep, id: candidate.id, action: "drop", kind: "unknown", domain: "other", displayName: "", parentEntity: "", phenomenon: "", evidenceIds: [], exclusionReason: "meaning_unknown", reason: "검색어만 있어 의미를 설명할 수 없음" })),
  }) } });
  assert.equal(result.review.error, null);
  assert.deepEqual(new Set(result.ranked.map((item) => item.term)), new Set(["두더지상", "처음듣는표현"]));
  assert.ok(result.ranked.every((item) => item.kind === "unknown" && item.meaningUnresolved && item.phenomenon === null));
});

test("지어낸 이름·다른 후보의 근거·누락·중복은 허용하지 않는다", () => {
  assert.equal(validateEditorial({ decisions: [keep] }, [packet])[0].displayName, "돌케이크");
  assert.throws(() => validateEditorial({ decisions: [{ ...keep, displayName: "새로 만든 밈" }] }, [packet]), /원문/);
  assert.throws(() => validateEditorial({ decisions: [{ ...keep, evidenceIds: ["other"] }] }, [packet]), /근거 ID/);
  assert.throws(() => validateEditorial({ decisions: [] }, [packet]), /누락/);
  assert.throws(() => validateEditorial({ decisions: [keep, keep] }, [packet]), /중복/);
  assert.throws(() => validateEditorial({ decisions: [{ ...keep, kind: "organization" }] }, [packet]), /인물/);
  assert.throws(() => validateEditorial({ decisions: [keep, { ...keep, id: 2 }] }, [packet, { ...packet, id: 2 }]), /중복 지정/);
  assert.throws(() => validateEditorial({ decisions: [{ ...keep, displayName: "늘신", parentEntity: "" }] }, [{ ...packet, evidence: [{ id: "cake", text: "오늘 신상 공개" }] }]), /원문/);
});

test("응답 주입 테스트는 외부 모델을 호출하지 않는다", async () => {
  const result = await editDiscovery([packet], { response: { decisions: [keep] }, generate: () => { throw new Error("네트워크 호출 금지"); } });
  assert.equal(result.model, "injected-test-response");
});

test("브랜드를 구체적인 현상으로 좁힐 때 다른 화제의 언급량을 가져오지 않는다", async () => {
  const rows = ["하겐다즈 돌케이크 자르기", "하겐다즈 돌케이크 칼 대결", "하겐다즈 가게 방문"].map((text, index) => ({
    site: "youtube", kind: "title", text, textHash: `hash${index}`, videoId: `video${index}`,
    meta: { channelId: `channel${index}` }, bucketAt: "2026-11-04T12:00:00Z",
  }));
  const cache = new Map(rows.map((row) => [row.textHash, { timeliness: "buzz", keywords: [{ name: "하겐다즈", category: "기업·주식", issue: null }] }]));
  let calls = 0;
  const result = await rankIssues(rows, cache, new Map(), { profile: "discovery", editorial: { models: ["test-editor"], generate: async (model, system, user) => {
    calls++;
    const candidates = JSON.parse(user).candidates;
    assert.equal(candidates.length, 1);
    const evidence = candidates[0].evidence.filter((item) => item.text.includes("돌케이크"));
    return { decisions: [{ ...keep, id: candidates[0].id, evidenceIds: evidence.map((item) => item.id) }] };
  } } });
  assert.equal(calls, 1);
  assert.equal(result.review.error, null);
  assert.equal(result.ranked[0].term, "돌케이크");
  assert.equal(result.ranked[0].mentions, 2);
  assert.equal(result.ranked[0].parentEntity, "하겐다즈");
  assert.equal(cache.get("hash2").keywords[0].name, "하겐다즈");
});

test("추출 모델이 원문을 누락하면 성공으로 보고하지 않는다", async () => {
  const rows = [{ site: "youtube", kind: "title", text: "새 작품", textHash: "one" }];
  const stats = await extractMissing(rows, new Map(), new Map(), { profile: "discovery", models: ["test-extractor"], generate: async () => ({ items: [] }) });
  assert.equal(stats.skipped, 1);
  assert.match(stats.error, /누락/);
});

test("의미 미확인 해시태그의 허용된 띄어쓰기 표기를 보존한다", async () => {
  const rows = ["09", "10", "11", "12"].map((hour) => ({
    site: "xtrends", kind: "title", text: "#HAPPY_K_DAY", textHash: "hashtag", meta: { rank: 13 }, bucketAt: `2026-11-04T${hour}:00:00Z`,
  }));
  const cache = new Map([["hashtag", { timeliness: "buzz", keywords: [{ name: "HAPPY K DAY", category: "유행어·밈" }] }]]);
  const result = await rankIssues(rows, cache, new Map(), { profile: "discovery", editorial: { models: ["offline"], generate: async (model, system, user) => ({
    decisions: JSON.parse(user).candidates.map((candidate) => ({ ...keep, id: candidate.id, action: "drop", kind: "unknown", domain: "other", displayName: "", parentEntity: "", phenomenon: "", evidenceIds: [], exclusionReason: "meaning_unknown", reason: "의미 미확인" })),
  }) } });
  assert.equal(result.review.error, null);
  assert.equal(result.ranked[0].term, "HAPPY K DAY");
  assert.equal(result.ranked[0].meaningUnresolved, true);
});

test("불완전한 편집 응답이면 미검수 순위를 대신 반환하지 않는다", async () => {
  const rows = ["one", "two"].map((textHash) => ({ site: "dcbest", kind: "title", text: "새 표현", textHash, bucketAt: "2026-11-04T12:00:00Z" }));
  const cache = new Map(rows.map((row) => [row.textHash, { timeliness: "buzz", keywords: [{ name: "새 표현", category: "유행어·밈" }] }]));
  const result = await rankIssues(rows, cache, new Map(), { profile: "discovery", editorial: { response: { decisions: [] } } });
  assert.equal(result.ranked.length, 0);
  assert.match(result.review.error, /누락/);
});

test("다단계 별칭을 같은 이름으로 해석해 근거를 보존한다", async () => {
  const rows = ["one", "two"].map((textHash) => ({ site: "dcbest", kind: "title", text: "마지막 표현 따라하기", textHash, bucketAt: "2026-11-04T12:00:00Z" }));
  const cache = new Map(rows.map((row) => [row.textHash, { timeliness: "buzz", keywords: [{ name: "처음 표현", category: "유행어·밈" }] }]));
  const aliases = new Map([["처음 표현", "중간 표현"], ["중간 표현", "마지막 표현"]]);
  const result = await rankIssues(rows, cache, aliases, { profile: "discovery", editorial: { models: ["offline"], generate: async (model, system, user) => {
    const [candidate] = JSON.parse(user).candidates;
    assert.equal(candidate.term, "마지막 표현");
    return { decisions: [{ ...keep, id: candidate.id, displayName: "마지막 표현", parentEntity: "", kind: "expression", domain: "expressions", evidenceIds: candidate.evidence.map((item) => item.id) }] };
  } } });
  assert.equal(result.review.error, null);
  assert.equal(result.ranked[0].mentions, 2);
});

test("별칭 순환은 진입점에 관계없이 같은 대상으로 해석한다", () => {
  const aliases = new Map([["A", "B"], ["B", "C"], ["C", "B"]]);
  assert.equal(canonicalTerm("A", aliases), "B");
  assert.equal(canonicalTerm("C", aliases), "B");
});

test("같은 원문은 편집 투영 뒤에도 출처별 카테고리 중복 표를 만들지 않는다", () => {
  const rows = ["dcbest", "gtrends"].map((site) => ({ site, kind: "title", text: "돌케이크", textHash: "same", bucketAt: "2026-11-04T12:00:00Z" }));
  const cache = new Map([["same", { timeliness: "buzz", keywords: [{ name: "돌케이크", category: "기업·주식" }] }]]);
  const packets = buildEvidencePackets([{ term: "돌케이크" }], rows, cache, new Map());
  const result = projectEditorial(rows, cache, new Map(), packets, [{ ...keep, displayName: "돌케이크", evidenceIds: packets[0].evidence.map((item) => item.id) }]);
  assert.equal(result.extractions.size, 1);
  assert.equal(result.rows.length, 2);
});
