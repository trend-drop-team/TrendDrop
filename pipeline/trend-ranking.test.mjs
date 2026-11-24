import { test } from "node:test";
import assert from "node:assert/strict";
import { extractNew, candidatesOf, linkCandidates, scoreCandidates } from "./trend-ranking.mjs";
const row = (site, text, rank = 1, bucket = 12, channel = "ch") => ({ site, kind: "title", text, textHash: `${site}:${text}:${channel}`, bucketAt: `2026-11-24T${bucket}:00:00.000Z`, videoId: site === "youtube" ? `${text}:${channel}` : null, meta: { rank, channelId: channel } });
const cacheFor = (rows) => new Map(rows.filter((r) => r.site !== "xtrends").map((r) => [r.textHash, { keywords: [{ name: r.text, category: "작품·콘텐츠" }] }]));

test("실제 흐름: X 추출 생략, 다른 소스 추출 1회, 별칭 연결 1회, 교차 점수", async () => {
  const rows = [row("xtrends", "두쫀쿠"), row("youtube", "두바이 쫀득 쿠키"), row("gtrends", "두쫀쿠")];
  const calls = [];
  const generate = async (_model, system, user) => {
    calls.push({ system, user });
    if (calls.length === 1) return { items: [
      { id: 1, timeliness: "buzz", keywords: [{ name: "두바이 쫀득 쿠키", surface: "두바이 쫀득 쿠키", category: "기업·주식" }] },
      { id: 2, timeliness: "buzz", keywords: [{ name: "두쫀쿠", surface: "두쫀쿠", category: "기업·주식" }] },
    ] };
    return { groups: [[1, 2]] };
  };
  const cache = new Map();
  const extracted = await extractNew(rows, cache, { generate });
  assert.equal(extracted.requests, 1);
  assert.ok(!calls[0].user.includes("X트렌드"));
  const candidates = candidatesOf(rows, cache);
  const links = await linkCandidates(candidates, { generate });
  const ranked = scoreCandidates(candidates, links.groups, { windowHours: 1 });
  assert.equal(calls.length, 2);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].score, 105);
  assert.equal(ranked[0].crossBonus, 20);
  assert.equal((await extractNew(rows, cache, { generate })).requests, 0);
});

test("댓글과 커뮤니티 제외, X 단독·유튜브 단독·Google 단독 후보도 진입", () => {
  const rows = [row("xtrends", "X단독"), row("youtube", "영상단독"), row("gtrends", "검색단독"), row("dcbest", "제외"), { ...row("youtube", "댓글"), kind: "comment" }];
  const ranked = scoreCandidates(candidatesOf(rows, cacheFor(rows)), [], { windowHours: 1 });
  assert.deepEqual(new Set(ranked.map((c) => c.term)), new Set(["X단독", "영상단독", "검색단독"]));
});

test("반복 버킷·동일 채널·별칭은 중복 점수가 없고 누락 시간은 0점", () => {
  const rows = [row("xtrends", "#새밈"), row("xtrends", "새 밈"), row("youtube", "새 밈"), row("youtube", "새 밈", 1, 13)];
  const ranked = scoreCandidates(candidatesOf(rows, cacheFor(rows)), [], { windowHours: 6 });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].score, 50 / 6 + 10 + 10);
});

test("신규 원문 51개도 1회만 추출하고 초과분은 다음 실행에서 처리", async () => {
  const rows = Array.from({ length: 51 }, (_, i) => row("youtube", `키워드${i}`));
  let calls = 0;
  const generate = async (_m, _s, user) => { calls++; return { items: JSON.parse(user).items.map((_, i) => ({ id: i + 1, keywords: [] })) }; };
  const cache = new Map();
  assert.equal((await extractNew(rows, cache, { generate })).deferred, 1);
  assert.equal(calls, 1);
  assert.equal((await extractNew(rows, cache, { generate })).extracted, 1);
  assert.equal(calls, 2);
});

test("연결 응답은 이름을 새로 만들거나 후보를 제거할 수 없다", async () => {
  const candidates = candidatesOf([row("xtrends", "가수"), row("xtrends", "노래")], new Map());
  await assert.rejects(linkCandidates(candidates, { generate: async () => ({ groups: [[1, 99]] }) }), /미등록/);
  await assert.rejects(linkCandidates(candidates, { generate: async () => ({ groups: [[1, 2], [2, 1]] }) }), /중복/);
});


test("Google 1위는 X 1위의 절반이며 표시 이름은 해시태그를 제거한다", () => {
  const rows = [row("xtrends", "#해시태그"), row("gtrends", "검색어")];
  const ranked = scoreCandidates(candidatesOf(rows, cacheFor(rows)), [], { windowHours: 1 });
  assert.deepEqual(ranked.map((c) => [c.term, c.score]), [["해시태그", 50], ["검색어", 25]]);
  assert.equal(rows[0].text, "#해시태그");
});

test("추출 과부하 시 두 번째 Lite로 전환하고 실제 성공 모델을 캐시에 기록한다", async () => {
  const rows = [row("youtube", "새 키워드")];
  const tried = [];
  const cache = new Map();
  const stats = await extractNew(rows, cache, { generate: async (model) => {
    tried.push(model);
    if (tried.length === 1) throw Object.assign(new Error("overloaded"), { status: 503 });
    return { items: [{ id: 1, keywords: [{ name: "새 키워드", surface: "새 키워드", category: "유행어·밈" }] }] };
  } });
  assert.deepEqual(tried, ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
  assert.equal(stats.model, "gemini-3.1-flash-lite");
  assert.equal(cache.get(rows[0].textHash).model, "gemini-3.1-flash-lite");
});
test("별칭 연결은 Flash를 먼저 쓰고 한도 초과일 때 다음 Flash로 전환한다", async () => {
  const candidates = candidatesOf([row("xtrends", "두쫀쿠"), row("xtrends", "두바이 쫀득 쿠키")], new Map());
  const tried = [];
  const result = await linkCandidates(candidates, { generate: async (model) => {
    tried.push(model);
    if (tried.length === 1) throw Object.assign(new Error("quota"), { status: 429 });
    return { groups: [[1, 2]] };
  } });
  assert.deepEqual(tried, ["gemini-3.8-flash", "gemini-3.6-flash"]);
  assert.equal(result.model, "gemini-3.6-flash");
});
test("Flash가 모두 한도 초과면 연결도 Lite를 사용할 수 있다", async () => {
  const candidates = candidatesOf([row("xtrends", "a"), row("xtrends", "b")], new Map());
  const tried = [];
  const result = await linkCandidates(candidates, { generate: async (model) => {
    tried.push(model);
    if (model.includes("flash-lite")) return { groups: [] };
    throw Object.assign(new Error("quota"), { status: 429 });
  } });
  assert.deepEqual(tried, ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"]);
  assert.equal(result.model, "gemini-3.5-flash-lite");
});
test("인증 오류에는 다른 모델을 사용하지 않는다", async () => {
  let calls = 0;
  await assert.rejects(extractNew([row("youtube", "a")], new Map(), { generate: async () => {
    calls++; throw Object.assign(new Error("bad key"), { status: 401 });
  } }), (e) => e.status === 401);
  assert.equal(calls, 1);
});
