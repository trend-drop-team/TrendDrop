-- 이슈 추출 전환(2026-10-14) — 글 단위 추출 캐시와 이름 사전.
-- 운영 Neon DB에는 같은 날 CREATE TABLE IF NOT EXISTS로 먼저 반영했다(db:push가 대화형 질문에서 멈춰서).
-- 그래서 0001처럼 멱등하게 둔다 — 기존 DB에선 no-op, 새 환경에선 실제로 생성된다.
CREATE TABLE IF NOT EXISTS "keyword_aliases" (
	"alias" text PRIMARY KEY NOT NULL,
	"canonical" text NOT NULL,
	"model" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "text_extractions" (
	"text_hash" varchar(64) PRIMARY KEY NOT NULL,
	"prompt_version" varchar(40) NOT NULL,
	"model" varchar(80),
	"timeliness" varchar(16) NOT NULL,
	"keywords" jsonb NOT NULL,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL
);
