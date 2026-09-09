import { notFound, redirect } from "next/navigation";

import { getTrends } from "@/server/services/trend.service";

export const dynamic = "force-dynamic";

/**
 * slug 없는 `/trend`는 현재 1위 키워드 상세로 넘긴다.
 * 상세 화면 자체는 `/trend/[slug]`가 담당한다.
 */
export default async function TrendIndexPage() {
  const { data } = await getTrends({ limit: 1 });
  const top = data[0];

  if (!top) notFound();

  redirect(`/trend/${encodeURIComponent(top.slug)}`);
}