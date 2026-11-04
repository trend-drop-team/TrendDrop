import { NextResponse } from "next/server";

import { getDocList } from "@/lib/docs";
import { getUserId } from "@/server/http/auth";
import { errorResponse } from "@/server/http/errors";
import { isAdmin } from "@/server/services/user.service";

/** 문서는 관리자만 본다(#79) — 편집/삭제 기능은 아직 없어 이 GET 하나가 전부다. */
export async function GET(request: Request) {
  const userId = getUserId(request);
  if (userId === null) return errorResponse("login required", 401);
  if (!(await isAdmin(userId))) return errorResponse("forbidden", 403);

  return NextResponse.json({
    data: getDocList(),
  });
}

