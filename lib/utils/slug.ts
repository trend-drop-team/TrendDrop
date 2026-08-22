/**
 * 키워드/카테고리 slug. 한글은 그대로 두고 공백만 하이픈으로 바꾼다
 * (로마자 변환을 하면 원문으로 되돌릴 수 없어 mock ↔ DB 매칭이 깨진다).
 * DB 경로에서는 `keywords.slug` 컬럼 값을 그대로 쓰고, 이 함수는 mock 폴백 전용이다.
 */
export function slugify(term: string): string {
  return term
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}
