import { isDbConfigured } from "@/db";
import { nowIso } from "@/lib/utils/date";
import { mockCategories } from "@/mocks/trends/repository";
import { dbCategories } from "@/server/repositories/category.repository";
import type { ApiResult } from "@/types/api/common";
import type { CategoryRow } from "@/types/api/category";

/** 3.1 GET /api/categories */
export async function getCategories(): Promise<ApiResult<CategoryRow[]>> {
  let rows = isDbConfigured() ? await dbCategories() : [];
  let source: "db" | "mock" = isDbConfigured() ? "db" : "mock";

  // 쿼리 실패가 아니라 "categories 테이블에 아직 데이터가 없다"는 정상 상태(파이프라인이
  // category_id를 아직 안 채움) — 예외를 던지고 catch하는 대신 여기서 명시적으로 처리한다.
  // 진짜 쿼리 실패(연결 오류·SQL 버그)는 여기서 잡지 않고 그대로 route.ts까지 던져 500으로 노출한다.
  if (rows.length === 0) {
    rows = mockCategories();
    source = "mock";
  }

  const data = rows.some((row) => row.slug === "all")
    ? rows
    : [{ name: "전체", slug: "all", sortOrder: 0 }, ...rows];

  return { data, meta: { source, updatedAt: nowIso() } };
}
