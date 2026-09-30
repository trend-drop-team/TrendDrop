"use client";

import { useEffect } from "react";

import { saveStaleCache, type StaleCacheSummary } from "@/lib/stale-cache";

/**
 * 화면이 정상적으로 그려졌을 때, 같은 화면이 다음에 실패하면 error.tsx가 보여줄
 * 최소 요약을 저장해 둔다. 화면에는 아무것도 그리지 않는다.
 */
export default function StaleCacheWriter({
  cacheKey,
  summary,
}: {
  cacheKey: string;
  summary: StaleCacheSummary;
}) {
  useEffect(() => {
    saveStaleCache(cacheKey, summary);
  }, [cacheKey, summary]);

  return null;
}
