ALTER TABLE "predictions" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN "next_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_attempt_count_nonnegative" CHECK ("predictions"."attempt_count" >= 0);