import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { loadRecentItems, closeDb } from "../store.mjs";
import { collect } from "../sources/youtube.mjs";
import { extractMissing, rankIssues } from "../issues.mjs";

try {
  const previous = await loadRecentItems(6);
  const bucketAt = previous.at(-1).bucketAt;
  const live = (await collect()).filter((item) => item.unit === "title").map((item) => ({
    site: "youtube", kind: "title", text: item.text, meta: item.meta, videoId: item.meta.videoId,
    textHash: createHash("sha1").update(item.text).digest("hex"), bucketAt,
  }));
  const rows = [...previous.filter((row) => row.kind !== "comment"), ...live];
  const extractions = new Map();
  console.log(JSON.stringify({ stage: "collected", liveTitles: live.length, unique: new Set(rows.map((row) => row.textHash)).size }));
  const stats = await extractMissing(rows, extractions, new Map(), {
    profile: "discovery",
    onBatch: async () => {
      await writeFile("/private/tmp/trenddrop-discovery-live.json", JSON.stringify({ rows, extractions: [...extractions] }));
      console.log(JSON.stringify({ stage: "extracting", done: extractions.size }));
    },
  });
  if (stats.skipped || stats.error) throw new Error(stats.error ?? "추출이 완료되지 않았습니다.");
  const result = await rankIssues(rows, extractions, new Map(), { profile: "discovery", useReview: true });
  await writeFile("/private/tmp/trenddrop-discovery-result.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ stage: "ranked", reviewError: result.review.error, ranked: result.ranked }));
  if (result.review.error) throw new Error(result.review.error);
} finally {
  await closeDb();
}
