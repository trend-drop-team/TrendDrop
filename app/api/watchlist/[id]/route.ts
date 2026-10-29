import { NextResponse } from "next/server";

import { isDbConfigured } from "@/db";
import { isAllowedOrigin } from "@/lib/allowed-origins";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { getActiveUserId } from "@/server/http/active-user";
import { errorResponse, handleRouteError } from "@/server/http/errors";
import { removeWatchlistItem } from "@/server/services/watchlist.service";

const WATCHLIST_WRITE_LIMIT = 20;
const WATCHLIST_WRITE_WINDOW_MS = 60_000;

/** 3.6 DELETE /api/watchlist/:id — 삭제. 남의 항목이면 404(존재 여부를 흘리지 않는다). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(request.headers.get("origin"))) {
    return errorResponse("forbidden origin", 403);
  }

  const userId = await getActiveUserId(request);
  if (userId === null) return errorResponse("login required", 401);

  // POST 쪽(app/api/watchlist/route.ts)과 같은 한도 — 쓰기 라우트 전체가 이 레이트리밋을 공유한다(#94).
  const rateLimit = checkRateLimit(`watchlist:write:${clientIp(request)}`, WATCHLIST_WRITE_LIMIT, WATCHLIST_WRITE_WINDOW_MS);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "too many requests" }, { status: 429, headers: { "retry-after": String(rateLimit.retryAfterSeconds) } });
  }

  if (!isDbConfigured()) {
    return errorResponse("watchlist requires a database", 500, "DATABASE_URL is not configured");
  }

  const { id } = await params;
  const itemId = Number.parseInt(id, 10);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    return errorResponse("invalid watchlist id", 400);
  }

  try {
    const removed = await removeWatchlistItem(userId, itemId);
    if (removed === 0) return errorResponse("watchlist item not found", 404);

    return NextResponse.json({ data: { id: itemId } });
  } catch (error) {
    return handleRouteError(error, "Failed to remove watchlist item");
  }
}