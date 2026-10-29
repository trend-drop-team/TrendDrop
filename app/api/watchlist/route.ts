import { NextResponse } from "next/server";

import { isDbConfigured } from "@/db";
import { isAllowedOrigin } from "@/lib/allowed-origins";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { MAX_KEYWORD_SLUG_LENGTH } from "@/lib/watchlist-constraints";
import { getActiveUserId } from "@/server/http/active-user";
import { errorResponse, handleRouteError } from "@/server/http/errors";
import { addWatchlistItem, getWatchlist } from "@/server/services/watchlist.service";

const WATCHLIST_WRITE_LIMIT = 20;
const WATCHLIST_WRITE_WINDOW_MS = 60_000;

/** 3.6 GET /api/watchlist — 저장한 키워드 목록. */
export async function GET(request: Request) {
  const userId = await getActiveUserId(request);
  if (userId === null) return errorResponse("login required", 401);

  try {
    return NextResponse.json(await getWatchlist(userId));
  } catch (error) {
    return handleRouteError(error, "Failed to load watchlist");
  }
}

/** 3.6 POST /api/watchlist { keywordSlug } — 추가(중복은 기존 항목을 그대로 돌려준다). */
export async function POST(request: Request) {
  if (!isAllowedOrigin(request.headers.get("origin"))) {
    return errorResponse("forbidden origin", 403);
  }

  const userId = await getActiveUserId(request);
  if (userId === null) return errorResponse("login required", 401);

  // 쓰기는 mock으로 대신할 수 없다 — DB 없이 성공을 돌려주면 저장된 척하는 UI가 된다.
  if (!isDbConfigured()) {
    return errorResponse("watchlist requires a database", 500, "DATABASE_URL is not configured");
  }

  const rateLimit = checkRateLimit(`watchlist:write:${clientIp(request)}`, WATCHLIST_WRITE_LIMIT, WATCHLIST_WRITE_WINDOW_MS);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "too many requests" },
      { status: 429, headers: { "retry-after": String(rateLimit.retryAfterSeconds) } }
    );
  }

  let keywordSlug: unknown;
  try {
    ({ keywordSlug } = (await request.json()) as { keywordSlug?: unknown });
  } catch {
    return errorResponse("invalid JSON body", 400);
  }

  if (typeof keywordSlug !== "string" || keywordSlug.trim() === "" || keywordSlug.length > MAX_KEYWORD_SLUG_LENGTH) {
    return errorResponse("keywordSlug is required", 400);
  }

  const slug = keywordSlug.trim();

  try {
    const id = await addWatchlistItem(userId, slug);
    return NextResponse.json({ data: { id, keywordSlug: slug } }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "Failed to add watchlist item");
  }
}