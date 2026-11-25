import { test } from "node:test";
import assert from "node:assert/strict";
import { extractNew, candidatesOf, linkCandidates, scoreCandidates, rankSkipReason } from "./trend-ranking.mjs";
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

test("미등록 ID가 든 그룹은 버리고 나머지 그룹은 쓴다 (랭킹 전체를 실패시키지 않는다)", async () => {
  const candidates = candidatesOf([row("xtrends", "가"), row("xtrends", "나"), row("xtrends", "다"), row("xtrends", "라")], new Map());
  const links = await linkCandidates(candidates, { generate: async () => ({ groups: [[1, 99], [3, 4]] }) });
  assert.deepEqual(links.groups, [[3, 4]]);
  assert.deepEqual(links.dropped, [{ group: [1, 99], reason: "미등록 ID" }]);
});

test("여러 그룹에 걸친 ID는 합치지 않고 관련 그룹을 모두 버린다", async () => {
  const candidates = candidatesOf([row("xtrends", "가"), row("xtrends", "나"), row("xtrends", "다"), row("xtrends", "라"), row("xtrends", "마")], new Map());
  const links = await linkCandidates(candidates, { generate: async () => ({ groups: [[1, 2], [2, 3], [4, 5]] }) });
  assert.deepEqual(links.groups, [[4, 5]]);
  assert.deepEqual(links.dropped.map((d) => d.reason), ["여러 그룹에 걸친 ID", "여러 그룹에 걸친 ID"]);
});

test("크기 1·같은 ID 반복·배열 아닌 그룹은 각 사유로 버린다", async () => {
  const candidates = candidatesOf([row("xtrends", "가"), row("xtrends", "나")], new Map());
  const links = await linkCandidates(candidates, { generate: async () => ({ groups: [[1], [2, 2], null] }) });
  assert.deepEqual(links.groups, []);
  assert.deepEqual(links.dropped.map((d) => d.reason), ["그룹 크기 오류", "그룹 내 중복 ID", "그룹 크기 오류"]);
});

test("이미 버린 그룹과 겹친다는 이유로 멀쩡한 그룹을 버리지 않는다", async () => {
  const candidates = candidatesOf([row("xtrends", "가"), row("xtrends", "나")], new Map());
  const links = await linkCandidates(candidates, { generate: async () => ({ groups: [[1], [1, 99], [1, 2]] }) });
  assert.deepEqual(links.groups, [[1, 2]]);
  assert.equal(links.dropped.length, 2);
});

test("연결 응답 형식 자체가 틀리면 실패한다", async () => {
  const candidates = candidatesOf([row("xtrends", "가"), row("xtrends", "나")], new Map());
  await assert.rejects(linkCandidates(candidates, { generate: async () => ({ pairs: [] }) }), /형식 오류/);
});

test("버린 그룹의 후보는 합쳐지지 않고 각자 점수를 받는다", async () => {
  const rows = [row("xtrends", "가", 1), row("xtrends", "나", 2), row("xtrends", "다", 3)];
  const candidates = candidatesOf(rows, new Map());
  const links = await linkCandidates(candidates, { generate: async () => ({ groups: [[1, 2], [2, 3]] }) });
  assert.deepEqual(scoreCandidates(candidates, links.groups, { windowHours: 1 }).map((c) => c.term), ["가", "나", "다"]);
});


test("Google 1위는 X 1위의 절반이며 표시 이름은 해시태그를 제거한다", () => {
  const rows = [row("xtrends", "#해시태그"), row("gtrends", "검색어")];
  const ranked = scoreCandidates(candidatesOf(rows, cacheFor(rows)), [], { windowHours: 1 });
  assert.deepEqual(ranked.map((c) => [c.term, c.score]), [["해시태그", 50], ["검색어", 25]]);
  assert.equal(rows[0].text, "#해시태그");
});

test("추출과 연결 모두 Haiku를 기본 모델로 사용한다", async () => {
  const rows = [row("youtube", "새 키워드"), row("xtrends", "다른 키워드")];
  const used = [];
  const generate = async (model, system, user, schema) => {
    used.push(model);
    return schema.properties.groups ? { groups: [] } : { items: [{ id: 1, keywords: [{ name: "새 키워드", surface: "새 키워드", category: "유행어·밈" }] }] };
  };
  const cache = new Map();
  const extraction = await extractNew(rows, cache, { generate });
  const links = await linkCandidates(candidatesOf(rows, cache), { generate });
  assert.deepEqual(used, ["claude-haiku-5-5", "claude-haiku-5-5"]);
  assert.equal(extraction.entries[0].model, "claude-haiku-5-5");
  assert.equal(links.model, "claude-haiku-5-5");
});

// #91 — 버킷 하나당 랭킹 1회
test("같은 버킷에 저장된 랭킹이 없으면 건너뛰지 않는다", () => {
  assert.equal(rankSkipReason("2026-11-24T15:00:00.000Z", null), null);
});

test("같은 버킷을 이미 랭킹했으면 run 번호와 함께 건너뛴다 (collect 실패·수동 재실행)", () => {
  const reason = rankSkipReason("2026-11-24T15:00:00.000Z", { id: 3281, status: "partial" });
  assert.match(reason, /2026-11-24T15:00:00.000Z/);
  assert.match(reason, /run 3281/);
});
