import { NextResponse } from "next/server";

import { parseLimit, parseRunId } from "@/lib/api/common";
import { handleRouteError } from "@/lib/api/http";
import { getTrends, parsePeriod } from "@/lib/api/service";

/**
 * 3.2 GET /api/trends?period=realtime|daily&category=&limit=30&runId=
 *
 * `runId`를 주면 그 시점 스냅샷을 그대로 돌려준다(홈 타임머신/타임랩스).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  try {
    const payload = await getTrends({
      period: parsePeriod(searchParams.get("period")),
      category: searchParams.get("category") ?? undefined,
      limit: parseLimit(searchParams.get("limit")),
      runId: parseRunId(searchParams.get("runId")),
    });

    return NextResponse.json(payload);
  } catch (error) {
    return handleRouteError(error, "Failed to load trends");
  }
}