import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/api/http";
import { getKeywordDetail } from "@/lib/api/service";

/** 3.3 GET /api/keywords/:slug — /trend/[slug] 상세 페이지. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  try {
    return NextResponse.json(await getKeywordDetail(decodeURIComponent(slug)));
  } catch (error) {
    return handleRouteError(error, "Failed to load keyword");
  }
}