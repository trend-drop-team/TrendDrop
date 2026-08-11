-- 2단계: sources 마스터 테이블 신설 + raw_signals.source_site(text) → source_id(FK) 전환
--
-- 실행: psql "$DATABASE_URL" -f trend-rising/migrations/002-sources-fk.sql
-- 되돌리기: 파일 하단 ROLLBACK 절 참고 (주석 처리됨)

BEGIN;

CREATE TABLE IF NOT EXISTS sources (
  id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       varchar(80) NOT NULL UNIQUE,
  kind       varchar(40) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sources (name, kind) VALUES
  ('디시인사이드 실시간 베스트', 'dcbest'),
  ('더쿠 핫게시판', 'theqoo'),
  ('인스티즈 실시간 인기', 'instiz'),
  ('YouTube Data API', 'youtube'),
  ('Google Trends RSS', 'gtrends')
ON CONFLICT (kind) DO NOTHING;

ALTER TABLE raw_signals ADD COLUMN source_id int REFERENCES sources(id);
UPDATE raw_signals r SET source_id = s.id FROM sources s WHERE s.kind = r.source_site;

-- 매핑 안 된 행이 있으면(예상치 못한 site 문자열) 여기서 멈춘다 — 조용히 넘어가지 않는다.
DO $$
DECLARE unmapped int;
BEGIN
  SELECT count(*) INTO unmapped FROM raw_signals WHERE source_id IS NULL;
  IF unmapped > 0 THEN
    RAISE EXCEPTION '% rows have no matching source_id — check source_site values', unmapped;
  END IF;
END $$;

ALTER TABLE raw_signals ALTER COLUMN source_id SET NOT NULL;
ALTER TABLE raw_signals DROP CONSTRAINT rising_raw_items_source_text_hash_bucket_at_key;
ALTER TABLE raw_signals ADD CONSTRAINT raw_signals_source_id_text_hash_bucket_at_key
  UNIQUE (source_id, text_hash, bucket_at);
ALTER TABLE raw_signals DROP COLUMN source_site;

COMMIT;

-- ── 되돌리기 ──────────────────────────────────────────────────
-- BEGIN;
-- ALTER TABLE raw_signals ADD COLUMN source_site text;
-- UPDATE raw_signals r SET source_site = s.kind FROM sources s WHERE s.id = r.source_id;
-- ALTER TABLE raw_signals ALTER COLUMN source_site SET NOT NULL;
-- ALTER TABLE raw_signals DROP CONSTRAINT raw_signals_source_id_text_hash_bucket_at_key;
-- ALTER TABLE raw_signals ADD CONSTRAINT rising_raw_items_source_text_hash_bucket_at_key
--   UNIQUE (source_site, text_hash, bucket_at);
-- ALTER TABLE raw_signals DROP COLUMN source_id;
-- DROP TABLE sources;
-- COMMIT;
