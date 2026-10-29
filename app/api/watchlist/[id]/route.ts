import { NextResponse } from "next/server";

import { isDbConfigured } from "@/db";
import { getUserId } from "@/server/http/auth";
import { errorResponse, handleRouteError } from "@/server/http/errors";
import { removeWatchlistItem } from "@/server/services/watchlist.service";

type DeleteWatchlistDependencies = {
  isDbConfigured: () => boolean;
  removeWatchlistItem: (userId: number, itemId: number) => Promise<number>;
};

/** 3.6 DELETE /api/watchlist/:id — 삭제. 남의 항목이면 404(존재 여부를 흘리지 않는다). */
export async function deleteWatchlistItem(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  dependencies: DeleteWatchlistDependencies = { isDbConfigured, removeWatchlistItem },
) {
  const userId = getUserId(request);
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
