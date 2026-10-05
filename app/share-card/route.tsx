import { ImageResponse } from "next/og";

import { fetchApi } from "@/lib/api-client";
import { loadOgFonts, ogFontOption } from "@/lib/og-font";
import type { ApiResult } from "@/types/api/common";
import type { KeywordDetail } from "@/types/api/keyword";
import type { TrendRow } from "@/types/api/trend";

import { SHARE_CARD_SIZE, type SquareRow, keywordSquareCard, topFiveSquareCard } from "./card";

/**
 * GET /share-card          → 오늘의 TOP5 정사각 카드(PNG)
 * GET /share-card?slug=... → 키워드 한 장짜리 카드(PNG)
 *
 * 공유 버튼이 이 PNG를 blob으로 받아 navigator.share(files)에 넘기거나, 지원하지
 * 않는 브라우저에서는 그대로 내려받는다. 링크 미리보기(opengraph-image)와 렌더러·
 * 폰트 경로를 공유하므로 두 카드의 톤이 어긋나지 않는다.
 */

// 순위는 수집 run마다 바뀐다 — 빌드 시점에 구워 두면 옛 순위가 박제된다.
export const dynamic = "force-dynamic";

const TOP_N = 5;

function isNotFound(error: unknown): boolean {
  return error instanceof Error && error.name === "NotFoundError";
}

async function keywordCard(slug: string) {
  const result = await fetchApi<ApiResult<KeywordDetail>>(
    `/api/keywords/${encodeURIComponent(slug)}`,
  );
  const detail = result.data;

  return keywordSquareCard({
    rank: detail.rank,
    keyword: detail.keyword,
    category: detail.category,
    growth: detail.growth,
    score: detail.score,
    velocity: detail.velocity,
    updatedAgo: detail.updatedAgo,
  });
}

async function topFiveCard() {
  let rows: SquareRow[] = [];

  try {
    const result = await fetchApi<ApiResult<TrendRow[]>>(`/api/trends?period=daily&limit=${TOP_N}`);
    rows = result.data
      .slice(0, TOP_N)
      .map((row) => ({ rank: row.rank, keyword: row.keyword, growth: row.growth }));
  } catch {
    // 순위를 못 받아도 "집계 중" 카드는 나가야 한다 — 빈 이미지보다 낫다.
  }

  return topFiveSquareCard(rows);
}

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug");

  let card;
  try {
    card = slug ? await keywordCard(slug) : await topFiveCard();
  } catch (error) {
    // 없는 키워드는 404로 알린다. 그 밖의 오류(백엔드 장애 등)는 그대로 올려 로그에 남긴다.
    if (isNotFound(error)) return new Response("keyword not found", { status: 404 });
    throw error;
  }

  const fonts = await loadOgFonts(card.text);

  return new ImageResponse(card.element, { ...SHARE_CARD_SIZE, ...ogFontOption(fonts) });
}
