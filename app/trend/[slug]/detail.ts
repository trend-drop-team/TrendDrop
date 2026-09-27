import { cache } from "react";

import { fetchApi } from "@/lib/api-client";
import type { KeywordDetail } from "@/types/api/keyword";

export type KeywordDetailResult = { detail: KeywordDetail; source: "db" | "mock" };

/**
 * 상세 API 한 번만 타기 위한 래퍼.
 * generateMetadata와 페이지 본문이 각각 fetch하면 한 요청에 두 번 나가므로 react cache로 묶는다.
 */
export const fetchKeywordDetail = cache(async (slug: string): Promise<KeywordDetailResult> => {
  const result = await fetchApi<{ data: KeywordDetail; meta: { source: "db" | "mock" } }>(
    `/api/keywords/${encodeURIComponent(slug)}`,
  );
  return { detail: result.data, source: result.meta.source };
});

/**
 * 실패를 null로 흡수하는 버전.
 * OG 이미지·메타태그는 404나 백엔드 장애에도 무언가는 내놔야 해서 던지면 안 된다.
 */
export const loadKeywordDetail = cache(async (slug: string): Promise<KeywordDetail | null> => {
  try {
    return (await fetchKeywordDetail(slug)).detail;
  } catch {
    return null;
  }
});
