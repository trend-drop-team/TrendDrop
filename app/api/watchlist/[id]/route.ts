import { NextResponse } from "next/server";

import { isDbConfigured } from "@/db";
import { isAllowedOrigin } from "@/lib/allowed-origins";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { getActiveUserId } from "@/server/http/active-user";
import { errorResponse, handleRouteError } from "@/server/http/errors";
import { removeWatchlistItem } from "@/server/services/watchlist.service";

const WATCHLIST_WRITE_LIMIT = 20;
const WATCHLIST_WRITE_WINDOW_MS = 60_000;

type DeleteWatchlistDependencies = {
  isDbConfigured: () => boolean;
  getActiveUserId: (request: Request) => Promise<number | null>;
  removeWatchlistItem: (userId: number, itemId: number) => Promise<number>;
};

/** 3.6 DELETE /api/watchlist/:id — 삭제. 남의 항목이면 404(존재 여부를 흘리지 않는다). */
export async function deleteWatchlistItem(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  dependencies: DeleteWatchlistDependencies = { isDbConfigured, getActiveUserId, removeWatchlistItem },
) {
  if (!isAllowedOrigin(request.headers.get("origin"))) {
    return errorResponse("forbidden origin", 403);
  }

  // POST 쪽(app/api/watchlist/route.ts)과 같은 이유로 getActiveUserId(DB 조회)보다 먼저 돈다.
  const rateLimit = checkRateLimit(`watchlist:write:${clientIp(request)}`, WATCHLIST_WRITE_LIMIT, WATCHLIST_WRITE_WINDOW_MS);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "too many requests" }, { status: 429, headers: { "retry-after": String(rateLimit.retryAfterSeconds) } });
  }

  const userId = await dependencies.getActiveUserId(request);
  if (userId === null) return errorResponse("login required", 401);

  if (!dependencies.isDbConfigured()) {
    return errorResponse("watchlist requires a database", 500, "DATABASE_URL is not configured");
  }

  const { id } = await params;
  const itemId = Number.parseInt(id, 10);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    return errorResponse("invalid watchlist id", 400);
  }

  try {
    const removed = await dependencies.removeWatchlistItem(userId, itemId);
    if (removed === 0) return errorResponse("watchlist item not found", 404);

    return NextResponse.json({ data: { id: itemId } });
  } catch (error) {
    return handleRouteError(error, "Failed to remove watchlist item");
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return deleteWatchlistItem(request, context);
}
