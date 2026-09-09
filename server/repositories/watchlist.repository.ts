import { and, desc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/db";
import {
  categories as categoriesTable,
  collectionRuns,
  keywords as keywordsTable,
  trendSnapshots,
  watchlistItems,
} from "@/db/schema";
import { NotFoundError } from "@/server/http/errors";
import { RUN_AT } from "@/server/repositories/shared";
import type { WatchlistRow } from "@/types/api/watchlist";

export async function dbWatchlist(userId: number): Promise<WatchlistRow[]> {
  const db = getDb();

  const items = await db
    .select({
      id: watchlistItems.id,
      keywordId: watchlistItems.keywordId,
      addedAt: watchlistItems.addedAt,
      term: keywordsTable.term,
      slug: keywordsTable.slug,
      category: categoriesTable.name,
    })
    .from(watchlistItems)
    .innerJoin(keywordsTable, eq(watchlistItems.keywordId, keywordsTable.id))
    .leftJoin(categoriesTable, eq(keywordsTable.categoryId, categoriesTable.id))
    .where(eq(watchlistItems.userId, userId))
    .orderBy(desc(watchlistItems.addedAt));

  if (items.length === 0) return [];

  const [latestRun] = await db
    .select({ id: collectionRuns.id })
    .from(collectionRuns)
    .orderBy(desc(RUN_AT))
    .limit(1);

  const scores = latestRun
    ? await db
        .select({ keywordId: trendSnapshots.keywordId, score: trendSnapshots.score })
        .from(trendSnapshots)
        .where(
          and(
            eq(trendSnapshots.runId, latestRun.id),
            inArray(
              trendSnapshots.keywordId,
              items.map((item) => item.keywordId),
            ),
          ),
        )
    : [];

  const scoreByKeyword = new Map(scores.map((row) => [row.keywordId, row.score]));

  return items.map((item) => ({
    id: item.id,
    keyword: item.term,
    slug: item.slug,
    category: item.category ?? "기타",
    score: scoreByKeyword.get(item.keywordId) ?? null,
    addedAt: item.addedAt.toISOString(),
  }));
}

export async function dbAddWatchlistItem(userId: number, keywordSlug: string): Promise<number> {
  const db = getDb();

  const [keyword] = await db
    .select({ id: keywordsTable.id })
    .from(keywordsTable)
    .where(eq(keywordsTable.slug, keywordSlug))
    .limit(1);

  if (!keyword) throw new NotFoundError(`keyword not found: ${keywordSlug}`);

  // 랭킹 행 ★와 워치리스트 패널이 같은 테이블을 쓰므로 중복 추가는 조용히 무시한다.
  const [inserted] = await db
    .insert(watchlistItems)
    .values({ userId, keywordId: keyword.id })
    .onConflictDoNothing({ target: [watchlistItems.userId, watchlistItems.keywordId] })
    .returning({ id: watchlistItems.id });

  if (inserted) return inserted.id;

  const [existing] = await db
    .select({ id: watchlistItems.id })
    .from(watchlistItems)
    .where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.keywordId, keyword.id)))
    .limit(1);

  return existing.id;
}

/** 삭제된 행 수. 0이면 남의 항목이거나 이미 지워진 항목. */
export async function dbRemoveWatchlistItem(userId: number, itemId: number): Promise<number> {
  const deleted = await getDb()
    .delete(watchlistItems)
    .where(and(eq(watchlistItems.id, itemId), eq(watchlistItems.userId, userId)))
    .returning({ id: watchlistItems.id });

  return deleted.length;
}
