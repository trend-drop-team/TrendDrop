import { NextResponse } from "next/server";

import { isDbConfigured } from "@/db";
import { getUserId } from "@/server/http/auth";
import { errorResponse, handleRouteError } from "@/server/http/errors";
import { addWatchlistItem, getWatchlist } from "@/server/services/watchlist.service";

/** 3.6 GET /api/watchlist — 저장한 키워드 목록. */
export async function GET(request: Request) {
  const userId = getUserId(request);
  if (userId === null) return errorResponse("login required", 401);

  try {
    return NextResponse.json(await getWatchlist(userId));
  } catch (error) {
    return handleRouteError(error, "Failed to load watchlist");
  }
}

/** 3.6 POST /api/watchlist { keywordSlug } — 추가(중복은 기존 항목을 그대로 돌려준다). */
export async function POST(request: Request) {
  const userId = getUserId(request);
  if (userId === null) return errorResponse("login required", 401);

  // 쓰기는 mock으로 대신할 수 없다 — DB 없이 성공을 돌려주면 저장된 척하는 UI가 된다.
  if (!isDbConfigured()) {
    return errorResponse("watchlist requires a database", 500, "DATABASE_URL is not configured");
  }

  let keywordSlug: unknown;
  try {
    ({ keywordSlug } = (await request.json()) as { keywordSlug?: unknown });
  } catch {
    return errorResponse("invalid JSON body", 400);
  }

  if (typeof keywordSlug !== "string" || keywordSlug.trim() === "") {
    return errorResponse("keywordSlug is required", 400);
  }

  try {
    const id = await addWatchlistItem(userId, keywordSlug.trim());
    return NextResponse.json({ data: { id, keywordSlug } }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "Failed to add watchlist item");
  }
}