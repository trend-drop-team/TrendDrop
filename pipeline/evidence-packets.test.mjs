import test from "node:test";
import assert from "node:assert/strict";
import { buildEvidencePackets, evidenceIdFor } from "./evidence-packets.mjs";

const candidate = { term: "밈", score: 12, mentions: 8, breadth: 3, discovery: { newMentions: 4 } };
function row(text, site, day, extra = {}) {
  return { text, textHash: text, site, kind: "title", bucketAt: `2026-11-0${day}T00:00:00Z`, ...extra };
}
function cache(rows, name = "밈") {
  return new Map(rows.map((item) => [item.textHash, { keywords: [{ name }] }]));
}

test("selects diverse sites and channels before filling by recency", () => {
  const rows = [
    row("a-new", "youtube", 4, { videoId: "a1", meta: { channelId: "a" } }),
    row("a-repeat", "youtube", 3, { videoId: "a2", meta: { channelId: "a" } }),
    row("b-old", "youtube", 1, { videoId: "b1", meta: { channelId: "b" } }),
    row("forum", "forum", 2), row("search", "gtrends", 1),
  ];
  const [packet] = buildEvidencePackets([candidate], rows, cache(rows), new Map());
  assert.deepEqual(packet.evidence.map((item) => item.text), ["a-new", "forum", "search", "b-old", "a-repeat"]);
  assert.deepEqual(packet.signals, { score: 12, mentions: 8, breadth: 3, discovery: { newMentions: 4 } });
  const [limited] = buildEvidencePackets([candidate], rows, cache(rows), new Map(), { maxEvidence: 4 });
  assert.equal(limited.evidence.length, 4);
  assert.equal(limited.evidence[3].channelId, "b");
});

test("deduplicates snapshots and video comments, preferring matching titles", () => {
  const rows = [
    row("comment", "youtube", 4, { kind: "comment", meta: { videoId: "v" } }),
    row("title", "youtube", 1, { videoId: "v" }),
    row("title", "youtube", 2, { videoId: "v" }),
    row("forum", "forum", 1), row("forum", "forum", 4),
    row("comment only", "youtube", 3, { kind: "comment", videoId: "other" }),
  ];
  const [packet] = buildEvidencePackets([candidate], rows, cache(rows), new Map());
  assert.equal(packet.evidence.length, 3);
  assert.equal(packet.evidence.find((item) => item.videoId === "v").text, "title");
  assert.equal(packet.evidence.find((item) => item.videoId === "v").bucketAt, rows[2].bucketAt);
  assert.equal(packet.evidence.find((item) => item.site === "forum").bucketAt, rows[4].bucketAt);
  assert.equal(packet.evidence.find((item) => item.videoId === "other").channelId, null);
  const reversed = buildEvidencePackets([candidate], [...rows].reverse(), cache(rows), new Map());
  assert.deepEqual(reversed, [packet]);
  const earlier = buildEvidencePackets([candidate], [rows[1]], cache(rows), new Map());
  assert.equal(earlier[0].evidence[0].id, packet.evidence.find((item) => item.videoId === "v").id);
});

test("uses cached aliases, excludes unrelated and uncached text, and preserves pool IDs", () => {
  const rows = [row("raw alias text", "forum", 1), row("밈 substring alone", "forum", 2), row("밈 uncached", "forum", 3)];
  const extractions = new Map([
    [rows[0].textHash, { keywords: [{ name: "short" }, { name: "밈" }] }],
    [rows[1].textHash, { keywords: [{ name: "unrelated" }] }],
  ]);
  const aliases = new Map([["short", "long"], ["long", "밈"], ["candidate alias", "밈"]]);
  const packets = buildEvidencePackets([{ term: "absent" }, { ...candidate, term: "candidate alias" }], rows, extractions, aliases);
  assert.deepEqual(packets.map((item) => item.id), [1, 2]);
  assert.deepEqual(packets[0].evidence, []);
  assert.deepEqual(packets[1].evidence.map((item) => item.text), ["raw alias text"]);
});

test("does not mutate inputs or share mutable discovery signals", () => {
  const pool = [structuredClone(candidate)];
  const rows = [row("raw", "forum", 1)];
  const extractions = cache(rows);
  const aliases = new Map([["short", "밈"]]);
  const before = structuredClone({ pool, rows, extractions, aliases });
  const packets = buildEvidencePackets(pool, rows, extractions, aliases);
  packets[0].signals.discovery.newMentions = 99;
  packets[0].evidence[0].text = "changed";
  assert.deepEqual({ pool, rows, extractions, aliases }, before);
  assert.deepEqual(buildEvidencePackets(pool, rows, extractions, aliases, { maxEvidence: 0 })[0].evidence, []);
});

test("keeps distinct sites, kinds, and videos when text is identical and channels are missing", () => {
  const rows = [
    row("same", "forum", 1),
    row("same", "other-forum", 1),
    row("same", "forum", 1, { kind: "comment" }),
    row("same", "youtube", 1, { videoId: "one" }),
    row("same", "youtube", 1, { videoId: "two" }),
  ];
  const packets = buildEvidencePackets([candidate], rows, cache(rows), new Map());
  assert.equal(packets[0].evidence.length, 5);
  assert.equal(new Set(packets[0].evidence.map((item) => item.id)).size, 5);
  assert.ok(packets[0].evidence.every((item) => item.channelId === null));
});

test("exported IDs project accepted videos and source items to all snapshot buckets", () => {
  const rows = [
    row("video title", "youtube", 1, { videoId: "v" }),
    row("changed title", "youtube", 2, { videoId: "v", meta: { channelId: "channel" } }),
    row("video comment", "youtube", 3, { kind: "comment", meta: { videoId: "v" } }),
    row("forum text", "forum", 1),
    row("forum text", "forum", 4),
    row("unaccepted", "forum", 4),
  ];
  const [packet] = buildEvidencePackets([candidate], rows.slice(0, 5), cache(rows), new Map());
  const accepted = new Set(packet.evidence.map((item) => item.id));
  assert.deepEqual(rows.filter((item) => accepted.has(evidenceIdFor(item))), rows.slice(0, 5));
  assert.equal(evidenceIdFor(rows[0]), evidenceIdFor(rows[1]));
  assert.equal(evidenceIdFor(rows[0]), evidenceIdFor(rows[2]));
  for (const evidence of packet.evidence) {
    assert.equal(evidence.id, evidenceIdFor(evidence));
    assert.equal(evidence.textHash, evidence.text);
  }
});

test("source identity uses site, kind, and textHash, falling back to raw text without a hash", () => {
  const original = row("raw", "forum", 1);
  assert.equal(evidenceIdFor(original), evidenceIdFor({ ...original, text: "changed", bucketAt: "later" }));
  for (const change of [{ site: "other" }, { kind: "comment" }, { textHash: "other" }]) {
    assert.notEqual(evidenceIdFor(original), evidenceIdFor({ ...original, ...change }));
  }
  const noHash = { ...original, textHash: undefined };
  assert.equal(evidenceIdFor(noHash), evidenceIdFor({ ...noHash, bucketAt: "later" }));
  assert.notEqual(evidenceIdFor(noHash), evidenceIdFor({ ...noHash, text: "other" }));
  assert.notEqual(evidenceIdFor(row("raw", "youtube", 1, { videoId: "one" })),
    evidenceIdFor(row("raw", "youtube", 1, { videoId: "two" })));
});
