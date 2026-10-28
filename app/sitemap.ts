import type { MetadataRoute } from "next";

import { fetchApiOr } from "@/lib/api-client";
import { getDocList } from "@/lib/docs";
import { siteUrl } from "@/lib/site";
import type { ApiResult } from "@/types/api/common";
import type { TrendRow } from "@/types/api/trend";

// 트렌드 슬러그는 수집 run마다 바뀐다. 빌드 때 백엔드 가동 여부에 묶이지 않도록 요청 시 만든다.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();

  // 백엔드가 죽어도 정적 페이지 사이트맵은 나가야 한다 — 실패하면 트렌드 상세만 빠진다.
  const trends = await fetchApiOr<{ data: TrendRow[] }>("/api/trends?period=daily", { data: [] });
  const slugs = [...new Set((trends.data ?? []).map((row) => row.slug))];

  return [
    { url: `${base}/`, changeFrequency: "hourly", priority: 1 },
    { url: `${base}/explore`, changeFrequency: "hourly", priority: 0.8 },
    { url: `${base}/docs`, changeFrequency: "weekly", priority: 0.4 },
    ...getDocList().map((doc) => ({
      url: `${base}/docs/${doc.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.3,
    })),
    ...slugs.map((slug) => ({
      url: `${base}/trend/${encodeURIComponent(slug)}`,
      changeFrequency: "hourly" as const,
      priority: 0.6,
    })),
  ];
}
