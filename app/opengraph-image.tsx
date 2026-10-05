import { ImageResponse } from "next/og";

import { fetchApi } from "@/lib/api-client";
import { loadOgFonts, ogFontOption } from "@/lib/og-font";
import type { ApiResult } from "@/types/api/common";
import type { TrendRow } from "@/types/api/trend";

import { OG_SIZE, topFiveCard } from "./og-card";

export const alt = "TrendDrop 오늘의 트렌드 TOP 5";
export const size = OG_SIZE;
export const contentType = "image/png";
// 수집 run마다 순위가 바뀐다 — 빌드 시점에 구워 두면 옛 순위가 박제된다.
export const dynamic = "force-dynamic";

const TOP_N = 5;

export default async function Image() {
  let rows: TrendRow[] = [];

  try {
    const result = await fetchApi<ApiResult<TrendRow[]>>(`/api/trends?period=daily&limit=${TOP_N}`);
    rows = result.data.slice(0, TOP_N);
  } catch {
    // 백엔드가 죽어도 링크 미리보기는 떠야 한다 — 순위 없이 브랜드 카드만 그린다.
  }

  const card = topFiveCard(
    rows.map((row) => ({ rank: row.rank, keyword: row.keyword, growth: row.growth })),
  );

  const fonts = await loadOgFonts(card.text);

  return new ImageResponse(card.element, { ...OG_SIZE, ...ogFontOption(fonts) });
}
