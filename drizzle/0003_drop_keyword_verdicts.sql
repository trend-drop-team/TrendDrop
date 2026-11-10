-- 옛 단어 판정 캐시 삭제(2026-10-14). 이슈 추출 전환으로 파이프라인이 더 이상 읽지도 쓰지도 않는다.
-- 운영 Neon DB에서는 같은 날 이미 지웠다 — IF EXISTS로 멱등하게 둔다.
DROP TABLE IF EXISTS "keyword_verdicts" CASCADE;