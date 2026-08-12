import { NextResponse } from "next/server";

import { isDbConfigured } from "@/db";
import { errorResponse, getUserId, handleRouteError } from "@/lib/api/http";
import { removeWatchlistItem } from "@/lib/api/service";

/** 3.6 DELETE /api/watchlist/:id — 삭제. 남의 항목이면 404(존재 여부를 흘리지 않는다). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(request);
  if (userId === null) return errorResponse("login required", 401);

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