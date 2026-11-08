import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { rankIssues, prepareDiscoveryPackets } from "../issues.mjs";
import { EDITOR_SYSTEM, EDITOR_SCHEMA, EDITOR_VERSION, validateEditorial } from "../discovery-editor.mjs";

const [mode, snapshotPath, artifactPath, outputPath] = process.argv.slice(2);
if (!["prepare", "apply"].includes(mode) || !snapshotPath || !artifactPath) throw new Error("Usage: evidence-replay.mjs prepare|apply snapshot.json packets-or-decisions.json [result.json]");
const snapshotText = await readFile(snapshotPath, "utf8");
const inputFingerprint = createHash("sha256").update(snapshotText).digest("hex");
const { rows, extractions: entries } = JSON.parse(snapshotText);
const extractions = new Map(entries);
const missing = rows.filter((row) => !extractions.has(row.textHash));
if (missing.length) throw new Error(`스냅샷의 ${missing.length}행에 추출 캐시가 없습니다.`);
const packets = prepareDiscoveryPackets(rows, extractions, new Map());
if (mode === "prepare") {
  await writeFile(artifactPath, JSON.stringify({ inputFingerprint, editorVersion: EDITOR_VERSION, system: EDITOR_SYSTEM, schema: EDITOR_SCHEMA, candidates: packets }, null, 2));
  console.log(JSON.stringify({ mode, candidates: packets.length, cacheKeys: extractions.size, uniqueTexts: new Set(rows.map((row) => row.text)).size, inputFingerprint }));
} else {
  const fixture = JSON.parse(await readFile(artifactPath, "utf8"));
  if (fixture.inputFingerprint !== inputFingerprint || fixture.editorVersion !== EDITOR_VERSION) throw new Error("응답과 원문 스냅샷·프롬프트 버전이 일치하지 않습니다.");
  validateEditorial(fixture, packets);
  const result = await rankIssues(rows, extractions, new Map(), { profile: "discovery", editorial: { response: fixture } });
  if (result.review.error) throw new Error(result.review.error);
  const baseline = await rankIssues(rows, extractions, new Map(), { profile: "general", useReview: false });
  const artifact = { inputFingerprint, editorVersion: EDITOR_VERSION, provenance: fixture.provenance ?? "injected-response", isGeminiBenchmark: false,
    generatedAt: new Date().toISOString(), dataBucketAt: rows.reduce((latest, row) => row.bucketAt > latest ? row.bucketAt : latest, ""),
    baseline: { review: false, terms: baseline.ranked.map((item) => item.term) }, result };
  if (outputPath) await writeFile(outputPath, JSON.stringify(artifact, null, 2));
  console.log(JSON.stringify({ mode, provenance: artifact.provenance, isGeminiBenchmark: false, terms: result.ranked.map(({ term, domain, parentEntity, mentions }) => ({ term, domain, parentEntity, mentions })) }));
}
