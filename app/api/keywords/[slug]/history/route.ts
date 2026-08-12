import { NextResponse } from "next/server";

import { parseWindowHours } from "@/lib/api/common";
import { handleRouteError } from "@/lib/api/http";
import { getKeywordHistory } from "@/lib/api/service";

/** 3.4 GET /api/keywords/:slug/history?window=12h — 스파크라인·A/B 비교·타임머신. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { searchParams } = new URL(request.url);

  try {
    const payload = await getKeywordHistory(
      decodeURIComponent(slug),
      parseWindowHours(searchParams.get("window")),
    );

    return NextResponse.json(payload);
  } catch (error) {
    return handleRouteError(error, "Failed to load keyword history");
  }
}