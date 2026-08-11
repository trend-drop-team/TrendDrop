-- 되돌리기 — ui_category 축을 걷어낸다.
--
-- 002 이후에 프론트 mock(lib/trend-data.ts)의 카테고리 값(푸드/뷰티/테크 등)을 그대로
-- 가져다 LLM 판정 축으로 추가했는데, trend-rising 실제 콘텐츠(인물·정치·사건사고·
-- 스포츠 등 커뮤니티 담론)와 안 맞아 재판정 결과 keep=true 117개 중 102개(87%)가
-- "기타"로 나왔다 — 사실상 못 쓰는 축이었다.
--
-- UI 카테고리가 필요하면 이미 있는 keyword_verdicts.content_type(인물/작품·콘텐츠/
-- 기업·주식/사건·사고/재난·속보/정치·사회/스포츠)을 그대로 쓴다.
--
-- keywords는 전량 raw_signals + keyword_verdicts에서 파생되는 테이블이라(popular_
-- snapshots와 동급) 손상된 category 값을 고치느니 비우고 다시 만드는 쪽이 깔끔하다.
-- 재생성: node trend-rising/backfill-popular.mjs --reset (API 0회)
--
-- 실행: psql "$DATABASE_URL" -f trend-rising/migrations/003-revert-ui-category.sql

BEGIN;

ALTER TABLE keyword_verdicts DROP COLUMN IF EXISTS ui_category;
TRUNCATE keywords RESTART IDENTITY;

COMMIT;
