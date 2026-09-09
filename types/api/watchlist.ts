/** 3.6 워치리스트 */
export type WatchlistRow = {
  id: number;
  keyword: string;
  slug: string;
  category: string;
  score: number | null;
  addedAt: string;
};
