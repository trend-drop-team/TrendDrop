/**
 * 기존 keywords의 category_id 일괄 백필 — keyword_verdicts 캐시만 사용, LLM 호출 0회.
 *
 * categories 7행을 시드한 뒤(store.mjs seedCategories), category_id가 비어 있는
 * keywords를 판정 캐시의 content_type으로 채운다. 멱등 — 다시 돌려도 이미 채워진
 * 행은 건드리지 않는다. 상세 로직은 store.mjs backfillKeywordCategories() 주석 참고.
 *
 * 실행:  node pipeline/backfill-categories.mjs
 *   env: DATABASE_URL
 */
import { backfillKeywordCategories, closeDb } from "./store.mjs";

const filled = await backfillKeywordCategories();
console.log(`✅ keywords.category_id 백필 — ${filled}건 채움`);
await closeDb();
