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
 * 입력 행: { site, kind, text, videoId?, meta?, bucketAt }
 */
import { tokenize } from "./tokenize.mjs";

/** site|kind → 가중치. 유튜브가 메인, 커뮤니티가 서브. */
export const WEIGHTS = {
  "gtrends|title": 20, // 이미 검증된 트렌드라 유튜브보다 살짝 위
  "youtube|title": 12,
  "youtube|comment": 3,
  "dcbest|title": 4,
  "theqoo|title": 4,
  "instiz|title": 4,
};

const DEFAULTS = {
  crossBonus: 1.25, // 2+ 소스 교차출현 가산 (v-he와 동일)
  minMentions: 2, // 1회성 단어 제거
  keepSources: ["gtrends"], // 이 소스에 있으면 minMentions 무시하고 통과
  limit: 30,
};

/** 같은 영상의 댓글이 같은 단어를 반복해 점수를 부풀리는 걸 막는다. */
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
 * 확정 가중치 20점이 "평균적인 급등검색어"의 점수로 유지되게 하고, 검색량에 따라
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

export function rankPopular(rows, options = {}) {
  const opt = { ...DEFAULTS, ...options };
  const weights = { ...WEIGHTS, ...(options.weights ?? {}) };
  if (rows.length === 0) throw new Error("빈 입력 — 창 안에 행이 없음");

  // 댓글에도 영상 확산속도를 얹기 위해(v-he와 동일) 제목 행에서 영상별 boost를 먼저 모은다.
  // 댓글 meta엔 videoId·likeCount만 있어 조회수를 직접 알 수 없다.
  const boostByVideo = new Map();
  for (const row of rows) {
    if (row.site === "youtube" && row.kind === "title" && row.videoId) {
      boostByVideo.set(row.videoId, videoBoost(row.meta, row.bucketAt));
    }
  }

  const acc = new Map();
  const seenVideo = new Set();
  const skipped = new Map(); // 가중치 미정의 site|kind 진단용
  let boosted = 0; // 참여도 보정이 실제로 걸린 행 수(진단용)

  for (const row of rows) {
    const key = `${row.site}|${row.kind}`;
    const base = weights[key];
    if (base === undefined) {
      skipped.set(key, (skipped.get(key) ?? 0) + 1);
      continue;
    }
    if (base === 0) continue;

    let boost = 1;
    if (key === "gtrends|title") boost = trafficBoost(row.meta);
    else if (key === "youtube|title") boost = videoBoost(row.meta, row.bucketAt);
    else if (key === "youtube|comment") {
      boost = commentBoost(row.meta) * (boostByVideo.get(row.videoId) ?? 1);
    }
    if (boost !== 1) boosted += 1;
    const weight = base * boost;

    for (const token of new Set(tokenize(row.text))) {
      const dedup = videoDedupKey(row, token);
      if (dedup) {
        if (seenVideo.has(dedup)) continue;
        seenVideo.add(dedup);
      }
      let entry = acc.get(token);
      if (!entry) {
        entry = {
          score: 0,
          mentions: 0,
          sources: new Map(), // source → 가중합
          units: new Set(),
          sample: row.text,
        };
        acc.set(token, entry);
      }
      entry.score += weight;
      entry.mentions += 1;
      entry.sources.set(row.site, (entry.sources.get(row.site) ?? 0) + weight);
      entry.units.add(key);
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
    });
  }

  ranked.sort((a, b) => b.score - a.score || b.mentions - a.mentions);

  return {
    ranked: ranked.slice(0, opt.limit),
    meta: {
      rows: rows.length,
      candidates: acc.size,
      passed: ranked.length,
      boostedRows: boosted,
      skipped: [...skipped.entries()].map(([key, n]) => ({ key, n })),
    },
  };
}
