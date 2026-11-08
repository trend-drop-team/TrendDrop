// keywordSlug는 keywords.slug(db/schema.ts)가 varchar(200)이라 그 이상은 어차피 일치할 수 없다 —
// DB까지 안 가고 바로 거부해 저장 가능한 값보다 긴 입력을 미리 쳐낸다.
// backend/server.ts(Express)와 app/api/watchlist/route.ts(Next) 양쪽이 같은 값을 써야
// 한쪽만 바뀌고 다른 쪽이 낡은 길이 제한으로 남는 걸 막는다.
export const MAX_KEYWORD_SLUG_LENGTH = 200;
