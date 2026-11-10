export function diversifyDiscovery(candidates, domains, limit = 10) {
  const remaining = [...candidates];
  const counts = new Map();
  const selected = [];
  while (remaining.length && selected.length < limit) {
    const adjusted = (item) => item.score * Math.pow(0.65, counts.get(domains.get(item.term)) ?? 0);
    remaining.sort((left, right) => adjusted(right) - adjusted(left));
    const item = remaining.shift();
    const domain = domains.get(item.term);
    selected.push({ ...item, discoveryBaseScore: item.score, score: Math.round(100 * (1 - Math.exp(-adjusted(item) / 400))), domain: domain ?? null });
    if (domain && domain !== "other") counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  return selected;
}

export function rankDiscovery(candidates, rows, termsOf, info, { limit = 10, windowHours = 6 } = {}) {
  const latest = Math.max(...rows.map((row) => Date.parse(row.bucketAt)));
  const split = latest - windowHours * 3.6e6 / 2;
  const channelsByVideo = new Map();
  for (const row of [...rows].sort((left, right) => Date.parse(left.bucketAt) - Date.parse(right.bucketAt))) {
    const videoId = row.videoId ?? row.meta?.videoId;
    if (row.site === "youtube" && videoId && row.meta?.channelId) channelsByVideo.set(videoId, row.meta.channelId);
  }
  const priorCohorts = new Set(rows.filter((row) => Date.parse(row.bucketAt) <= split)
    .map((row) => `${row.site}|${row.meta?.categoryId ?? "general"}`));
  const evidence = new Map();
  for (const row of rows) {
    for (const term of new Set(termsOf(row))) {
      let item = evidence.get(term);
      if (!item) {
        item = { recent: new Set(), prior: new Set(), trendBuckets: new Set(), origins: new Set(), latest: 0, comparable: false, audienceEvidence: false };
        evidence.set(term, item);
      }
      const time = Date.parse(row.bucketAt);
      const ageHours = (time - Date.parse(row.meta?.publishedAt)) / 3.6e6;
      if (row.site === "youtube" && row.kind === "title" && ageHours >= 0 && ageHours <= 72 && row.meta?.viewCount >= 100000 && row.meta.viewCount / Math.max(ageHours, 1) >= 5000) {
        item.audienceEvidence = true;
      }
      if (priorCohorts.has(`${row.site}|${row.meta?.categoryId ?? "general"}`)) item.comparable = true;
      const identity = `${row.site}|${row.videoId ?? row.textHash ?? row.text}`;
      const videoId = row.videoId ?? row.meta?.videoId;
      item.origins.add(row.site === "youtube" ? `youtube|${channelsByVideo.get(videoId) ?? row.meta?.channelId ?? videoId ?? row.textHash}` : `${row.site}|${row.textHash ?? row.text}`);
      (time > split ? item.recent : item.prior).add(identity);
      item.latest = Math.max(item.latest, time);
      if (["xtrends", "gtrends"].includes(row.site) && Number.isFinite(row.meta?.rank) && row.meta.rank <= 20) {
        item.trendBuckets.add(row.bucketAt);
      }
    }
  }
  const ranked = candidates.flatMap((candidate) => {
    const item = evidence.get(candidate.term);
    const category = info(candidate.term).category;
    if (!item || !item.recent.size) return [];
    if (item.origins.size < 2 && item.trendBuckets.size < 2 && !item.audienceEvidence) return [];
    if (candidate.mentions < 2 && !item.audienceEvidence && !(item.trendBuckets.size >= 2 && ["유행어·밈", "작품·콘텐츠"].includes(category))) return [];
    const newMentions = [...item.recent].filter((identity) => !item.prior.has(identity)).length;
    const momentum = (newMentions + 1) / (item.prior.size + 1);
    const novelty = item.comparable ? Math.min(2.5, Math.max(0.35, momentum)) : 1;
    const preference = category === "유행어·밈" ? 2 : ["인물", "정치·사회", "스포츠", "사건·사고", "재난·속보"].includes(category) ? 0.25 : 1;
    const freshness = Math.pow(0.5, (latest - item.latest) / (3.6e6 * windowHours / 2));
    const confidence = item.origins.size >= 2 || item.trendBuckets.size >= 2 ? 1 : 0.6;
    const discoveryScore = Math.round(Math.log1p(candidate.score) * novelty * preference * freshness * confidence * 100);
    return [{ ...candidate, popularityScore: candidate.score, score: discoveryScore,
      discovery: { newMentions, priorMentions: item.prior.size, momentum: item.comparable ? momentum : null, comparable: item.comparable, independentOrigins: item.origins.size, audienceEvidence: item.audienceEvidence, trendBuckets: item.trendBuckets.size } }];
  });
  return ranked.sort((left, right) => right.score - left.score || right.mentions - left.mentions).slice(0, limit);
}
