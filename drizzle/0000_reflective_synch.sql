CREATE TYPE "public"."fixture_game_state" AS ENUM('scheduled', 'live', 'finished', 'postponed', 'cancelled', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."participant_kind" AS ENUM('human', 'agent');--> statement-breakpoint
CREATE TYPE "public"."prediction_chain_status" AS ENUM('pending', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."prediction_outcome" AS ENUM('yes', 'no', 'higher', 'lower');--> statement-breakpoint
CREATE TYPE "public"."question_comparison" AS ENUM('equal', 'greater_than', 'less_than');--> statement-breakpoint
CREATE TYPE "public"."question_operator" AS ENUM('add', 'subtract');--> statement-breakpoint
CREATE TYPE "public"."question_result" AS ENUM('yes', 'no', 'higher', 'lower', 'push');--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('scheduled', 'open', 'locked', 'live', 'settling', 'settled', 'void');--> statement-breakpoint
CREATE TABLE "fixtures" (
	"id" text PRIMARY KEY NOT NULL,
	"home_team" text NOT NULL,
	"away_team" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"game_state" "fixture_game_state" DEFAULT 'scheduled' NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fixtures_last_seq_nonnegative" CHECK ("fixtures"."last_seq" >= 0)
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "participant_kind" NOT NULL,
	"wallet_address" varchar(44),
	"display_name" varchar(32),
	"points" integer DEFAULT 0 NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"best_streak" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participants_wallet_address_unique" UNIQUE("wallet_address"),
	CONSTRAINT "participants_points_nonnegative" CHECK ("participants"."points" >= 0),
	CONSTRAINT "participants_current_streak_nonnegative" CHECK ("participants"."current_streak" >= 0),
	CONSTRAINT "participants_best_streak_nonnegative" CHECK ("participants"."best_streak" >= 0)
);
--> statement-breakpoint
CREATE TABLE "predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"outcome" "prediction_outcome" NOT NULL,
	"prediction_pda" varchar(44),
	"chain_status" "prediction_chain_status" DEFAULT 'pending' NOT NULL,
	"signature" varchar(88),
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"scored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "predictions_prediction_pda_unique" UNIQUE("prediction_pda"),
	CONSTRAINT "predictions_participant_question_unique" UNIQUE("participant_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fixture_id" text NOT NULL,
	"benchmark_fixture_id" text,
	"template" text NOT NULL,
	"stat_key_1" text NOT NULL,
	"stat_key_2" text NOT NULL,
	"period" text,
	"operator" "question_operator" NOT NULL,
	"comparison" "question_comparison" NOT NULL,
	"threshold" integer,
	"benchmark_value" integer,
	"status" "question_status" DEFAULT 'scheduled' NOT NULL,
	"result" "question_result",
	"opens_at" timestamp with time zone NOT NULL,
	"locks_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"last_error" text,
	"question_pda" varchar(44),
	"settlement_signature" varchar(88),
	"rule_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_question_pda_unique" UNIQUE("question_pda"),
	CONSTRAINT "questions_rule_hash_unique" UNIQUE("rule_hash"),
	CONSTRAINT "questions_attempt_count_nonnegative" CHECK ("questions"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"privy_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_participant_id_unique" UNIQUE("participant_id"),
	CONSTRAINT "users_privy_user_id_unique" UNIQUE("privy_user_id")
);
--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_fixture_id_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_benchmark_fixture_id_fixtures_id_fk" FOREIGN KEY ("benchmark_fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;