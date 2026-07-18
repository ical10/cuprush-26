CREATE TYPE "public"."agent_cohort_status" AS ENUM('active', 'paused', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('seeded', 'active', 'paused', 'revoked');--> statement-breakpoint
CREATE TABLE "agent_cohorts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" varchar(64) NOT NULL,
	"token_hash" text,
	"status" "agent_cohort_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	CONSTRAINT "agent_cohorts_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "agent_decisions" (
	"participant_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"confidence" numeric NOT NULL,
	"rationale" varchar(280) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_decisions_participant_question_unique" UNIQUE("participant_id","question_id"),
	CONSTRAINT "agent_decisions_confidence_range" CHECK ("agent_decisions"."confidence" >= 0 AND "agent_decisions"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"participant_id" uuid PRIMARY KEY NOT NULL,
	"cohort_id" uuid NOT NULL,
	"agent_key" varchar(32) NOT NULL,
	"persona" text NOT NULL,
	"strategy" text NOT NULL,
	"model" varchar(64) NOT NULL,
	"privy_wallet_id" varchar(64),
	"status" "agent_status" DEFAULT 'seeded' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_agent_key_unique" UNIQUE("agent_key"),
	CONSTRAINT "agents_privy_wallet_id_unique" UNIQUE("privy_wallet_id")
);
--> statement-breakpoint
ALTER TABLE "participants" ALTER COLUMN "kind" SET DEFAULT 'human';--> statement-breakpoint
ALTER TABLE "agent_cohorts" ADD CONSTRAINT "agent_cohorts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_cohort_id_agent_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."agent_cohorts"("id") ON DELETE restrict ON UPDATE no action;