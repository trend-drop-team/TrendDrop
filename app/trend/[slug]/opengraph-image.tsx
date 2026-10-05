import { ImageResponse } from "next/og";

import { loadOgFonts, ogFontOption } from "@/lib/og-font";

import { OG_SIZE, keywordCard, topFiveCard } from "../../og-card";
import { loadKeywordDetail } from "./detail";

export const alt = "TrendDrop 트렌드 카드 — 키워드 순위와 검색 상승률";
export const size = OG_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detail = await loadKeywordDetail(slug);

  // 없는 키워드거나 백엔드가 응답하지 않으면 빈 카드 대신 브랜드 카드로 떨어진다.
  const card = detail
    ? keywordCard({
        rank: detail.rank,
        keyword: detail.keyword,
        category: detail.category,
        growth: detail.growth,
        score: detail.score,
        velocity: detail.velocity,
        updatedAgo: detail.updatedAgo,
      })
    : topFiveCard([]);

  const fonts = await loadOgFonts(card.text);

  return new ImageResponse(card.element, { ...OG_SIZE, ...ogFontOption(fonts) });
}
