import { asc } from "drizzle-orm";
import { cache } from "react";

import { getDb } from "@/db";
import { categories as categoriesTable } from "@/db/schema";
import type { CategoryRow } from "@/types/api/category";

/** DB의 카테고리 원본 그대로. 비어 있으면 빈 배열 — 파이프라인이 category_id를 아직
 * 채우지 않아 실제로 비어 있을 수 있는 정상 상태이지 쿼리 실패가 아니다.
 *
 * layout과 page가 각각 getCategories()를 부르므로 한 렌더에서 두 번 호출된다.
 * cache()로 요청 단위 메모이즈해 실제 쿼리는 한 번만 나가게 한다. */
export const dbCategories = cache(async function dbCategories(): Promise<CategoryRow[]> {
  return getDb()
    .select({
      name: categoriesTable.name,
      slug: categoriesTable.slug,
      sortOrder: categoriesTable.sortOrder,
    })
    .from(categoriesTable)
    .orderBy(asc(categoriesTable.sortOrder));
});
