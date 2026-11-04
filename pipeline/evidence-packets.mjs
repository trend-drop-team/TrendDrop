import { createHash } from "node:crypto";
import { canonicalTerm as canonical } from "./canonical-term.mjs";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const videoIdOf = (row) => row.videoId ?? row.meta?.videoId ?? null;
const channelIdOf = (row) => row.channelId ?? row.meta?.channelId ?? null;
const timeOf = (row) => Date.parse(row.bucketAt) || 0;
const identityOf = (row) => row.site === "youtube" && videoIdOf(row)
  ? JSON.stringify([row.site, videoIdOf(row)])
  : JSON.stringify([row.site, row.kind, row.textHash ?? hash(row.text)]);
export function evidenceIdFor(row) {
  return hash(identityOf(row));
}
const newestFirst = (a, b) => timeOf(b) - timeOf(a)
  || evidenceIdFor(a).localeCompare(evidenceIdFor(b))
  || hash([a.kind, a.text, channelIdOf(a)]).localeCompare(hash([b.kind, b.text, channelIdOf(b)]));

function selectEvidence(rows, limit) {
  const remaining = [...rows].sort(newestFirst);
  const selected = [];
  const sites = new Set();
  const channels = new Set();
  while (remaining.length && selected.length < limit) {
    let index = remaining.findIndex((row) => !sites.has(row.site));
    if (index < 0) index = remaining.findIndex((row) => {
      const channel = channelIdOf(row);
      return channel != null && !channels.has(JSON.stringify([row.site, channel]));
    });
    if (index < 0) index = 0;
    const [row] = remaining.splice(index, 1);
    sites.add(row.site);
    if (channelIdOf(row) != null) channels.add(JSON.stringify([row.site, channelIdOf(row)]));
    selected.push({
      id: evidenceIdFor(row), site: row.site, kind: row.kind, text: row.text,
      textHash: row.textHash ?? null,
      videoId: videoIdOf(row), channelId: channelIdOf(row), bucketAt: row.bucketAt ?? null,
      channelTitle: row.meta?.channelTitle ?? null,
      publishedAt: row.meta?.publishedAt ?? null,
      viewCount: row.meta?.viewCount ?? null,
      likeCount: row.meta?.likeCount ?? null,
      trendRank: row.meta?.rank ?? null,
    });
  }
  return selected;
}

export function buildEvidencePackets(pool, rows, extractions, aliases, { maxEvidence = 5 } = {}) {
  const byTerm = new Map();
  for (const row of rows) {
    const names = new Set((extractions.get(row.textHash)?.keywords ?? [])
      .map((keyword) => canonical(keyword.name, aliases)));
    for (const name of names) {
      if (!byTerm.has(name)) byTerm.set(name, new Map());
      const evidence = byTerm.get(name);
      const key = identityOf(row);
      const previous = evidence.get(key);
      const video = row.site === "youtube" && videoIdOf(row);
      const titleWins = video && row.kind === "title" && previous?.kind !== "title";
      const titleLoses = video && row.kind !== "title" && previous?.kind === "title";
      if (!previous || titleWins || (!titleLoses && newestFirst(row, previous) < 0)) evidence.set(key, row);
    }
  }
  const limit = Number.isFinite(maxEvidence) ? Math.max(0, Math.floor(maxEvidence)) : 5;
  return pool.map((candidate, index) => ({
    id: index + 1,
    term: candidate.term,
    signals: {
      score: candidate.score, mentions: candidate.mentions, breadth: candidate.breadth,
      discovery: structuredClone(candidate.discovery ?? null),
    },
    evidence: selectEvidence(byTerm.get(canonical(candidate.term, aliases))?.values() ?? [], limit),
  }));
}
