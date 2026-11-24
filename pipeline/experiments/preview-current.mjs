/** 실시간 한 회차를 실행한다. DB·운영 순위에는 쓰지 않고 /tmp에 입출력을 남긴다. */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { collect as x } from "../sources/xtrends.mjs";
import { collect as youtube } from "../sources/youtube.mjs";
import { collect as google } from "../sources/gtrends.mjs";
import { hourBucket } from "../collect.mjs";
import { extractNew, candidatesOf, linkCandidates, scoreCandidates } from "../trend-ranking.mjs";
import { generateJson, CLAUDE_MODEL } from "../claude.mjs";

const output = process.env.PREVIEW_OUTPUT || "/tmp/trenddrop-138-preview";
await mkdir(output, { recursive: true });
const now = new Date();
const report = { capturedAt: now.toISOString(), windowHours: 1, sources: [], ai: [] };
const rows = [];
const replay = process.argv.includes("--replay") ? JSON.parse(await readFile(`${output}/report.json`, "utf8")) : null;
for (const [name, collect] of [["xtrends", x], ["youtube", youtube], ["gtrends", google]]) {
  try {
    const saved = name === "xtrends" && process.argv.includes("--refresh-x") ? null : replay?.sources.find((s) => s.name === name);
    if (saved?.error) throw new Error(saved.error);
    const items = saved ? saved.items : await collect();
    report.sources.push({ name, count: items.length, items });
    for (const item of items) rows.push({ site: item.source, kind: item.unit, text: item.text,
      textHash: createHash("sha1").update(JSON.stringify([item.source, item.meta?.videoId ?? null, item.text, item.meta?.newsTitles ?? []])).digest("hex"),
      videoId: item.meta?.videoId ?? null, meta: item.meta, bucketAt: hourBucket(now) });
  } catch (error) {
    report.sources.push({ name, error: error.message });
  }
}
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
const generate = async (model, system, user, schema) => {
  const call = { model, system, user, schema };
  report.ai.push(call);
  try { call.result = await generateJson(model, system, user, schema); return call.result; }
  catch (error) { call.error = error.message; throw error; }
  finally { await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); }
};
try {
  const previousEntries = replay?.extraction?.entries?.length ? replay.extraction.entries : replay?.reusedExtraction?.entries ?? [];
  const cache = new Map(previousEntries.filter((entry) => entry.model === CLAUDE_MODEL).map((entry) => [entry.textHash, entry]));
  if (previousEntries.length) report.reusedExtraction = { entries: previousEntries, previousCalls: (replay.ai ?? []).filter((call) => call.result?.items) };
  report.extraction = await extractNew(rows, cache, { generate });
  report.candidates = candidatesOf(rows, cache);
  report.links = await linkCandidates(report.candidates, { generate });
  report.ranked = scoreCandidates(report.candidates, report.links.groups, { windowHours: 1 });
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, sources: report.sources.map(({ name, count, error }) => ({ name, count, error })), claudeRequests: report.ai.length,
    extraction: report.extraction && { extracted: report.extraction.extracted, deferred: report.extraction.deferred },
    groups: report.links?.groups, ranked: report.ranked, error: report.error }, null, 2));
}
