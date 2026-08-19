import { isDbConfigured } from "@/db";
import { nowIso } from "@/lib/utils/date";
import { mockWatchlist } from "@/mocks/trends/repository";
import {
  dbAddWatchlistItem,
  dbRemoveWatchlistItem,
  dbWatchlist,
} from "@/server/repositories/watchlist.repository";
import type { ApiResult } from "@/types/api/common";
import type { WatchlistRow } from "@/types/api/watchlist";

/**
 * 3.6 워치리스트 — 모두 로그인한 user_id가 필요하다.
 *
 * 빈 워치리스트는 mock으로 대체하지 않는다 — 실제 로그인 사용자가 저장한 게 없다는
 * 정상 상태를 mock 예시 항목으로 가리면 오히려 거짓 정보가 된다(category/heatmap/trend의
 * "데이터가 아직 없다"와는 다른 케이스).
 */
export async function getWatchlist(userId: number): Promise<ApiResult<WatchlistRow[]>> {
  const source: "db" | "mock" = isDbConfigured() ? "db" : "mock";
  const data = isDbConfigured() ? await dbWatchlist(userId) : mockWatchlist();
  return { data, meta: { source, updatedAt: nowIso() } };
}

export async function addWatchlistItem(userId: number, keywordSlug: string): Promise<number> {
  return dbAddWatchlistItem(userId, keywordSlug);
}

export async function removeWatchlistItem(userId: number, itemId: number): Promise<number> {
  return dbRemoveWatchlistItem(userId, itemId);
}
