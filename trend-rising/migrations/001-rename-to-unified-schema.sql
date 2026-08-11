-- 1단계: 무손실 rename — 통합 스키마 이름으로 맞춤 (trend-rising-rename-plan.md 기준)
-- 대상: rising_raw_items → raw_signals, popular_runs → collection_runs,
--       popular_term_verdicts → keyword_verdicts
-- popular_snapshots는 여기서 손대지 않는다 (trend_snapshots 이름이 jin의 db/schema.ts와
-- 충돌 — 그 코드가 지워진 뒤 3단계에서 처리).
--
-- 실행: psql "$DATABASE_URL" -f trend-rising/migrations/001-rename-to-unified-schema.sql
-- 되돌리기: 파일 하단 ROLLBACK 절 참고 (주석 처리됨)

BEGIN;

-- ── raw_signals ──────────────────────────────────────────────
-- source(사이트)와 unit(신호 종류)이 서로 자리를 바꾸므로 임시 이름을 거친다.
ALTER TABLE rising_raw_items RENAME COLUMN source TO source_site;
ALTER TABLE rising_raw_items RENAME COLUMN unit TO source;
ALTER TABLE rising_raw_items RENAME COLUMN collected_at TO captured_at;

ALTER TABLE rising_raw_items ADD COLUMN IF NOT EXISTS video_id text;
UPDATE rising_raw_items SET video_id = meta->>'videoId'
  WHERE video_id IS NULL AND meta ? 'videoId';

ALTER TABLE rising_raw_items RENAME TO raw_signals;

-- ── collection_runs ──────────────────────────────────────────
ALTER TABLE popular_runs RENAME COLUMN ran_at TO started_at;
ALTER TABLE popular_runs RENAME COLUMN item_count TO raw_signal_count;
ALTER TABLE popular_runs RENAME TO collection_runs;

-- ── keyword_verdicts ─────────────────────────────────────────
ALTER TABLE popular_term_verdicts RENAME COLUMN category TO content_type;
ALTER TABLE popular_term_verdicts RENAME TO keyword_verdicts;

-- popular_snapshots가 참조하던 FK 이름은 자동으로 새 이름을 따라간다 (Postgres가
-- REFERENCES popular_runs(id)를 collection_runs(id)로 자동 갱신함 — 별도 조치 불필요).

COMMIT;

-- ── 되돌리기 (문제 생기면 이 블록만 실행) ────────────────────
-- BEGIN;
-- ALTER TABLE keyword_verdicts RENAME TO popular_term_verdicts;
-- ALTER TABLE popular_term_verdicts RENAME COLUMN content_type TO category;
-- ALTER TABLE collection_runs RENAME TO popular_runs;
-- ALTER TABLE popular_runs RENAME COLUMN raw_signal_count TO item_count;
-- ALTER TABLE popular_runs RENAME COLUMN started_at TO ran_at;
-- ALTER TABLE raw_signals RENAME TO rising_raw_items;
-- ALTER TABLE rising_raw_items DROP COLUMN video_id;
-- ALTER TABLE rising_raw_items RENAME COLUMN captured_at TO collected_at;
-- ALTER TABLE rising_raw_items RENAME COLUMN source TO unit;
-- ALTER TABLE rising_raw_items RENAME COLUMN source_site TO source;
-- COMMIT;
