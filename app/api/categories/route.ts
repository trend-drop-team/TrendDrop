import { NextResponse } from "next/server";

import { handleRouteError } from "@/server/http/errors";
import { getCategories } from "@/server/services/category.service";

/** 3.1 GET /api/categories — 홈 카테고리 탭, /explore 히트맵 행 순서. */
export async function GET() {
  try {
    return NextResponse.json(await getCategories());
  } catch (error) {
    return handleRouteError(error, "Failed to load categories");
  }
}