-- 이 마이그레이션은 파일만 있고 journal에 등록돼 있지 않아서 migrate가 한 번도 실행하지 않았다.
-- 그 사이 운영 Neon DB에는 db:push로 두 컬럼이 이미 들어가 있다(2026-09-10 실측).
-- 그래서 IF NOT EXISTS로 멱등하게 둔다 — 기존 DB에서는 no-op으로 지나가면서
-- __drizzle_migrations에 0001이 기록되고, 새 환경에서는 컬럼이 실제로 생성된다.
ALTER TABLE "trend_snapshots" ADD COLUMN IF NOT EXISTS "rising_score" integer;--> statement-breakpoint
ALTER TABLE "trend_snapshots" ADD COLUMN IF NOT EXISTS "baseline_mentions" integer;
