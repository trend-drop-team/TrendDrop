ALTER TABLE "users" ADD COLUMN "provider" varchar(20);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "provider_id" varchar(120);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "session_token_min_iat" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "users_provider_id_idx" ON "users" USING btree ("provider","provider_id");