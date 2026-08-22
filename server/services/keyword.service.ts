import { isDbConfigured } from "@/db";
import { clockLabel, nowIso, relativeTime } from "@/lib/utils/date";
import { normalize } from "@/lib/utils/normalize";
import { mockHistory, mockKeywordDetail } from "@/mocks/trends/repository";
import { NotFoundError } from "@/server/http/errors";
import {
  dbFindKeywordBySlug,
  dbHistoryIngredients,
  dbKeywordContents,
  dbKeywordRelatedTerms,
  dbKeywordSnapshotHistory,
} from "@/server/repositories/keyword.repository";
import { parseReasons } from "@/server/repositories/shared";
import type { ApiResult } from "@/types/api/common";
import type { HistoryPoint, KeywordDetail } from "@/types/api/keyword";

/** 3.3 GET /api/keywords/:slug — 없는 slug면 NotFoundError(404). */
export async function getKeywordDetail(slug: string): Promise<ApiResult<KeywordDetail>> {
  if (!isDbConfigured()) {
    const detail = mockKeywordDetail(slug);
    if (!detail) throw new NotFoundError(`keyword not found: ${slug}`);
    return { data: detail, meta: { source: "mock", updatedAt: nowIso() } };
  }

  const keyword = await dbFindKeywordBySlug(slug);
  if (!keyword) throw new NotFoundError(`keyword not found: ${slug}`);

  const history = await dbKeywordSnapshotHistory(keyword.id);
  const latest = history[0];
  if (!latest) throw new NotFoundError(`snapshot not found: ${slug}`);

  // history는 최신 → 과거 순이므로 차트용으로 뒤집는다.
  const chronological = [...history].reverse();
  const now = latest.runAt;

  const [contents, relatedTerms] = await Promise.all([
    dbKeywordContents(keyword.id),
    dbKeywordRelatedTerms(keyword.id),
  ]);

  const reasons = parseReasons(latest.reasons);
  const channels = [
    ...new Set([
      ...reasons.map((reason) => reason.source),
      ...(latest.sourceLabel ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
    ]),
  ];

  const data: KeywordDetail = {
    rank: latest.rank ?? 0,
    keyword: keyword.term,
    slug: keyword.slug,
    category: keyword.category ?? "기타",
    growth: latest.growthRate ?? "-",
    velocity: latest.velocity ?? "-",
    score: latest.score ?? 0,
    detectedAgo: relativeTime(keyword.firstSeenAt, now),
    updatedAgo: relativeTime(latest.capturedAt, now),
    summary: latest.summary ?? "",
    reasons,
    series: normalize(chronological.map((row) => row.score ?? 0)),
    days: chronological.map((row) => clockLabel(row.runAt)),
    related: contents.map((content) => ({
      platform: content.source ?? content.kind,
      title: content.title,
      metric: content.metricLabel ?? "",
      kind: content.kind,
      url: content.url,
      thumbnailUrl: content.thumbnailUrl,
      // 4.1절 excerpt 컬럼이 스키마에 추가되기 전까지는 채울 데이터가 없다.
      excerpt: null,
    })),
    keywords: relatedTerms,
    channels,
    // 4.2절 trend_events 테이블이 추가되기 전까지는 빈 배열 — 화면이 합성 데이터로 대체한다.
    timeline: [],
  };

  return { data, meta: { source: "db", updatedAt: nowIso() } };
}

/** 3.4 GET /api/keywords/:slug/history */
export async function getKeywordHistory(
  slug: string,
  windowHours: number,
): Promise<ApiResult<HistoryPoint[]>> {
  if (!isDbConfigured()) {
    const points = mockHistory(slug);
    if (points.every((point) => point.rank === null)) {
      throw new NotFoundError(`keyword not found: ${slug}`);
    }
    return { data: points, meta: { source: "mock", updatedAt: nowIso(), windowHours } };
  }

  const keyword = await dbFindKeywordBySlug(slug);
  if (!keyword) throw new NotFoundError(`keyword not found: ${slug}`);

  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const { runs, rows } = await dbHistoryIngredients(keyword.id, since);
  const byRun = new Map(rows.map((row) => [row.runId, row]));

  // 해당 시점에 순위권 밖이면 rank: null — 이탈 구간을 차트에서 끊어 그리기 위함.
  // 창 안에 run이 없으면(방금 진입한 키워드 등) 빈 배열 — 정상 상태이지 에러가 아니다.
  const data: HistoryPoint[] = runs.map((run) => {
    const row = byRun.get(run.id);
    return { runId: run.id, rank: row?.rank ?? null, score: row?.score ?? 0 };
  });

  return { data, meta: { source: "db", updatedAt: nowIso(), windowHours } };
}
