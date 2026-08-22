import { NextResponse } from "next/server";

import { parseWindowHours } from "@/server/http/query";
import { handleRouteError } from "@/server/http/errors";
import { getHeatmap } from "@/server/services/heatmap.service";

/** 3.5 GET /api/explore/heatmap?window=12h — /explore 카테고리 히트맵. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  try {
    return NextResponse.json(await getHeatmap(parseWindowHours(searchParams.get("window"))));
  } catch (error) {
    return handleRouteError(error, "Failed to load heatmap");
  }
}