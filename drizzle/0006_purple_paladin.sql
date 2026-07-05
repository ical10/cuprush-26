CREATE TABLE "prediction_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"batch_hash" text NOT NULL,
	"batch_pda" varchar(44),
	"chain_status" "prediction_chain_status" DEFAULT 'pending' NOT NULL,
	"signature" varchar(88),
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prediction_batches_participant_id_unique" UNIQUE("participant_id"),
	CONSTRAINT "prediction_batches_batch_pda_unique" UNIQUE("batch_pda"),
	CONSTRAINT "prediction_batches_attempt_count_nonnegative" CHECK ("prediction_batches"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "predictions" DROP CONSTRAINT "predictions_prediction_pda_unique";--> statement-breakpoint
ALTER TABLE "predictions" DROP CONSTRAINT "predictions_attempt_count_nonnegative";--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN "batch_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "prediction_batches" ADD CONSTRAINT "prediction_batches_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_batch_id_prediction_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."prediction_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" DROP COLUMN "prediction_pda";--> statement-breakpoint
ALTER TABLE "predictions" DROP COLUMN "chain_status";--> statement-breakpoint
ALTER TABLE "predictions" DROP COLUMN "signature";--> statement-breakpoint
ALTER TABLE "predictions" DROP COLUMN "submitted_at";--> statement-breakpoint
ALTER TABLE "predictions" DROP COLUMN "confirmed_at";--> statement-breakpoint
ALTER TABLE "predictions" DROP COLUMN "attempt_count";--> statement-breakpoint
ALTER TABLE "predictions" DROP COLUMN "next_retry_at";--> statement-breakpoint
ALTER TABLE "predictions" DROP COLUMN "last_error";