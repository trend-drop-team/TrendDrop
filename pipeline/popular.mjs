/**
 * 인기(popular) 랭킹 — "지금 많이 언급되는 것".
 *
 * 옛 급상승(rising) 방식과 정반대의 관점이다. 과거와 비교하지 않고, 창 안의 신호를
 * 소스 종류별 가중치로 합산해 절대 언급량 순위를 낸다.
 * lib/pipeline-v-he/trend-refine.ts 의 rankKeywords 구조를 그대로 따르되,
 * 소스가 유튜브·구글트렌드 2종에서 커뮤니티 4곳을 더한 6종으로 늘었다.
 *
 *   score = Σ(가중치)  ×  교차 소스 보너스
 *
 * 글·영상·검색어 하나는 창 안에서 한 번만 센다(2026-10-20). 그 전엔 매시간 재수집된 같은 항목을 매번 세서, 몇 시간씩 목록에 머무는 구글·유튜브가 머문 만큼 쌓였다.
 *
 * 참여도 보정(v-he의 boost들)은 meta가 있을 때만 적용되고, 없으면 ×1이다.
 * 따라서 지표가 없던 과거 데이터와 지표가 쌓이는 앞으로의 데이터가 같은 코드로
 * 돌아간다. 커뮤니티 4곳은 조회수·추천수를 긁지 않으므로 항상 ×1이다.
 *
 * v-he와 다른 점:
 *  - 교차 보너스의 "소스"는 source 단위(6종)로 센다. v-he는 한 유튜브 안에서
 *    제목/태그/댓글을 서로 다른 소스로 쳤지만, 여기선 "여러 커뮤니티가 동시에
 *    다루는가"가 더 의미 있는 신호라 매체 단위로 묶었다.
 *  - boost의 기준점을 옮겼다. 자세한 건 각 boost 함수 주석 참고.
 *
 * 집계 단위(키워드)는 호출 측이 termsOf로 넘긴다 — 지금은 issues.mjs의 글 단위 추출 결과.
 * (2026-10-14 전까지는 tokenize.mjs로 단어를 쪼개 셌다. 그 방식은 이름이 쪼개져서 폐기)
 *
 * 입력 행: { site, kind, text, textHash?, videoId?, meta?, bucketAt }
 */

/**
 * site|kind → 가중치.
 * 2026-10-14 유튜브를 절반으로 낮췄다(제목 12 → 6, 댓글 3 → 1.5). 옛 방식에선 상위 20 점수의
 * 71%가 유튜브였다 — 급상승 영상 20개가 몇 시간씩 머물러서. 구글을 30~40으로 올려 보기도 했는데
 * 커뮤니티 언급 없는 검색어가 상위를 채워서 20 그대로 두고, 대신 교차 보너스를 키웠다.
 * 2026-10-20 항목당 1회 모델로 바꾸면서 구글을 8로 내렸다 — 실측은 PIPELINE.md 참고.
 */
export const WEIGHTS = {
  "xtrends|title": 8, // X 트렌드 하나 = 구글 검색어 하나와 같은 값 (이미 집계된 트렌드)
  "gtrends|title": 8, // 검색어 하나 = 커뮤니티 글 2개 값. 항목당 1회 모델에서 20이면 top10의 90%가 구글이었다(2026-10-20)
  "youtube|title": 6,
  "youtube|comment": 1.5,
  "dcbest|title": 4,
  "theqoo|title": 4,
  "instiz|title": 4,
};

const DEFAULTS = {
  crossBonus: 1.6, // 2+ 소스 교차출현 가산. "여러 곳에서 동시에 말하는 것"이 위로 (v-he는 1.25)
  minMentions: 2, // 1회성 단어 제거
  keepSources: ["gtrends", "xtrends"], // 둘 다 이미 집계된 트렌드라 글 1개여도 통과 (minMentions 무시)
  limit: 30,
  windowHours: 6,
};

/**
 * 같은 영상의 제목·댓글이 같은 키워드를 반복해도 창 안에서 1번만 센다.
 */
function videoDedupKey(row, token) {
  return row.site === "youtube" && row.videoId ? `${row.videoId}|${token}` : null;
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** "1000+" → 1000. 파싱 실패 시 null. */
function parseTraffic(raw) {
  if (!raw) return null;
  const n = Number(String(raw).replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * gtrends 검색량 보정. v-he는 `1 + log10(t+1)/4` 라 항상 1 이상이었고 그만큼
 * gtrends 실효 가중치가 통째로 올라갔다. 여기선 중앙값 부근(500)을 1.0으로 잡아
 * 확정 가중치(지금 8점)가 "평균적인 급등검색어"의 점수로 유지되게 하고, 검색량에 따라
 * 그 위아래로 흩어지게 했다 — 20건이 전부 동점으로 나오던 문제도 이걸로 풀린다.
 *   100+ ≈ ×0.83 | 500+ ≈ ×1.00 | 1000+ ≈ ×1.08 | 10000+ ≈ ×1.33 | 100000+ ≈ ×1.58
 */
const TRAFFIC_PIVOT = 500;
function trafficBoost(meta) {
  const t = parseTraffic(meta?.approxTraffic);
  if (t === null) return 1;
  return clamp(1 + (Math.log10(t + 1) - Math.log10(TRAFFIC_PIVOT + 1)) / 4, 0.7, 1.8);
}

/**
 * 유튜브 영상 확산속도 보정 (v-he videoBoost 공식 그대로, 범위 ×1~3.5).
 * meta에 viewCount/publishedAt이 없으면(=statistics 수집 전 데이터) ×1.
 * 조회수는 수집 시점 값이라 bucketAt 기준으로 시간당 조회수를 낸다.
 */
function videoBoost(meta, bucketAt) {
  const views = meta?.viewCount;
  if (!views || !meta?.publishedAt) return 1;
  const published = Date.parse(meta.publishedAt);
  if (!Number.isFinite(published)) return 1;
  const hours = Math.max((Date.parse(bucketAt) - published) / 3.6e6, 1);
  const velocity = Math.min(Math.log10(views / hours + 1), 5) / 2;
  const likes = meta.likeCount ? Math.min(meta.likeCount / 100_000, 0.5) : 0;
  return 1 + velocity + likes;
}

/**
 * 댓글 좋아요 보정. v-he는 `1 + min(like/50, 4)` 로 최대 ×5였는데, 그러면
 * 댓글(3점)이 제목(12점)을 넘어서 "유튜브 제목 중심"으로 정한 가중치 의도가
 * 뒤집힌다. ×1~2로 좁혀 제목 아래에 머물게 했다.
 */
function commentBoost(meta) {
  const likes = meta?.likeCount;
  if (!likes) return 1;
  return 1 + Math.min(likes / 50, 4) / 4;
}

/**
 * options.termsOf(row)       행에서 집계 단위(키워드 이름 배열)를 뽑는다. 필수.
 * options.rowMultiplier(row) 행 가중치에 곱할 배율. 기본 1.
 * options.termMultiplier(term, row) 키워드별 배율(카테고리 계수용). 기본 1.
 */
export function rankPopular(rows, options = {}) {
  const opt = { ...DEFAULTS, ...options };
  const termsOf = options.termsOf;
  if (!termsOf) throw new Error("rankPopular: options.termsOf가 필요함");
  const rowMultiplier = options.rowMultiplier ?? (() => 1);
  const termMultiplier = options.termMultiplier ?? (() => 1);
  const weights = { ...WEIGHTS, ...(options.weights ?? {}) };
  if (rows.length === 0) throw new Error("빈 입력 — 창 안에 행이 없음");

  // 댓글에도 영상 확산속도를 얹기 위해(v-he와 동일) 제목 행에서 영상별 boost를 먼저 모은다.
  // 댓글 meta엔 videoId·likeCount만 있어 조회수를 직접 알 수 없다.
  // 같은 영상의 제목 행이 여럿이면 bucketAt이 가장 큰(최신) 행의 값을 쓴다.
  const boostByVideo = new Map();
  for (const row of rows) {
    if (row.site === "youtube" && row.kind === "title" && row.videoId) {
      const prev = boostByVideo.get(row.videoId);
      if (!prev || row.bucketAt > prev.bucketAt) {
        boostByVideo.set(row.videoId, { bucketAt: row.bucketAt, boost: videoBoost(row.meta, row.bucketAt) });
      }
    }
  }

  // 사전 패스: 같은 글은 창 안에서 한 번만 센다. 키에 소스를 넣어 다른 소스의 같은 텍스트는 합치지 않는다.
  // 같은 키가 또 나오면 bucketAt이 큰(최신) 행을 남긴다 — 조회수·검색량 meta는 시간이 갈수록 커진다.
  // Map은 처음 본 순서를 유지하므로 입력 순서와 무관하게 bucketAt 비교로 정한다.
  const skipped = new Map(); // 가중치 미정의 site|kind 진단용
  const latestRowByKey = new Map();
  let weightedRows = 0;
  for (const row of rows) {
    const key = `${row.site}|${row.kind}`;
    const base = weights[key];
    if (base === undefined) {
      skipped.set(key, (skipped.get(key) ?? 0) + 1);
      continue;
    }
    if (base === 0) continue;
    weightedRows += 1;
    // videoId도 키에 넣는다 — 다른 영상의 똑같은 댓글("ㅋㅋㅋ")은 다른 글이다
    const rowKey = `${row.site}|${row.kind}|${row.videoId ?? ""}|${row.textHash ?? row.text}`;
    const prev = latestRowByKey.get(rowKey);
    if (!prev || row.bucketAt > prev.bucketAt) latestRowByKey.set(rowKey, row);
  }
  const deduped = weightedRows - latestRowByKey.size; // 중복으로 합쳐진 행 수(진단용)

  const acc = new Map();
  const latestBucket = rows.reduce((latest, row) =>
    !latest || row.bucketAt > latest ? row.bucketAt : latest, null);
  const latestTime = Date.parse(latestBucket);
  // 항목당 1회 모델에서는 최신 등장 시각으로 세므로, recentMentions = 지난 1시간에도 아직 목록에 있는 항목 수
  const recentStart = latestTime - 60 * 60 * 1000;
  const baselineStart = latestTime - opt.windowHours * 60 * 60 * 1000;
  const recentCounts = new Map();
  const baselineCounts = new Map();
  const baselineBucketsByTerm = new Map();
  const seenVideo = new Set();
  let boosted = 0; // 참여도 보정이 실제로 걸린 행 수(진단용)

  // 유튜브 제목 행을 댓글 행보다 먼저 돈다 — 같은 영상의 같은 키워드는 1번만 세는데(videoDedupKey),
  // 먼저 본 행이 점수를 가져가므로 제목(6점)이 댓글(1.5점)에 밀리지 않게. 입력 순서에 의존하지 않는다.
  const items = [...latestRowByKey.values()].sort((a, b) => Number(a.kind === "comment") - Number(b.kind === "comment"));
  for (const row of items) {
    const key = `${row.site}|${row.kind}`;
    const base = weights[key];

    let boost = 1;
    if (key === "gtrends|title") boost = trafficBoost(row.meta);
    else if (key === "youtube|title") boost = videoBoost(row.meta, row.bucketAt);
    else if (key === "youtube|comment") {
      boost = commentBoost(row.meta) * (boostByVideo.get(row.videoId)?.boost ?? 1);
    }
    if (boost !== 1) boosted += 1;
    const weight = base * boost * rowMultiplier(row);

    for (const token of new Set(termsOf(row))) {
      const dedup = videoDedupKey(row, token);
      if (dedup) {
        if (seenVideo.has(dedup)) continue;
        seenVideo.add(dedup);
      }
      const w = weight * termMultiplier(token, row);
      let entry = acc.get(token);
      if (!entry) {
        entry = {
          score: 0,
          mentions: 0,
          sources: new Map(), // source → 가중합
          units: new Set(),
          sample: row.text,
          boostSum: 0, // velocity(확산 속도) 산출용 — 참여도 보정값의 누적
          boostCount: 0,
        };
        acc.set(token, entry);
      }
      entry.score += w;
      entry.mentions += 1;
      const bucketTime = Date.parse(row.bucketAt);
      if (bucketTime >= recentStart) recentCounts.set(token, (recentCounts.get(token) ?? 0) + 1);
      else if (bucketTime >= baselineStart) {
        baselineCounts.set(token, (baselineCounts.get(token) ?? 0) + 1);
        let buckets = baselineBucketsByTerm.get(token);
        if (!buckets) {
          buckets = new Set();
          baselineBucketsByTerm.set(token, buckets);
        }
        buckets.add(row.bucketAt);
      }
      entry.sources.set(row.site, (entry.sources.get(row.site) ?? 0) + w);
      entry.units.add(key);
      entry.boostSum += boost;
      entry.boostCount += 1;
    }
  }

  const ranked = [];
  for (const [term, entry] of acc) {
    const passesFloor =
      entry.mentions >= opt.minMentions ||
      opt.keepSources.some((s) => entry.sources.has(s));
    if (!passesFloor) continue;

    const breadth = entry.sources.size;
    const bonus = breadth >= 2 ? opt.crossBonus : 1;
    const sources = [...entry.sources.entries()]
      .map(([source, weightSum]) => ({ source, weightSum: Math.round(weightSum) }))
      .sort((a, b) => b.weightSum - a.weightSum);

    ranked.push({
      term,
      score: Math.round(entry.score * bonus),
      rawScore: entry.score,
      mentions: entry.mentions,
      breadth,
      crossed: breadth >= 2,
      sources,
      units: [...entry.units],
      sample: entry.sample,
      // 확산 속도(0~10) — 참여도 보정(videoBoost/trafficBoost/commentBoost)의 평균.
      // 보정 없는 커뮤니티만 언급되면 1에 가깝고, 조회수·좋아요·검색량이 높을수록 커진다.
      velocity: clamp(entry.boostSum / Math.max(entry.boostCount, 1), 0.5, 10),
      recentMentions: recentCounts.get(term) ?? 0,
      baselineMentions: baselineCounts.get(term) ?? 0,
      risingScore: Math.round(clamp(
        ((recentCounts.get(term) ?? 0) / Math.max(
          (baselineCounts.get(term) ?? 0) / Math.max(baselineBucketsByTerm.get(term)?.size ?? 1, 1) + 1,
          1
        )) * 50,
        0, 100
      )),
    });
  }

  ranked.sort((a, b) => b.score - a.score || b.mentions - a.mentions);

  return {
    ranked: ranked.slice(0, opt.limit),
    meta: {
      rows: rows.length,
      deduped,
      baselineBuckets: new Set(rows.filter((row) => {
        const time = Date.parse(row.bucketAt);
        return time >= baselineStart && time < recentStart;
      }).map((row) => row.bucketAt)).size,
      candidates: acc.size,
      passed: ranked.length,
      boostedRows: boosted,
      skipped: [...skipped.entries()].map(([key, n]) => ({ key, n })),
    },
  };
}
