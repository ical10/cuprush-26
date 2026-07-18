-- Per-fixture prediction batches (issue #32).
-- Safe on a LIVE database with existing single-fixture batches: add the
-- column nullable, backfill each batch's fixture from its predictions'
-- questions, then enforce NOT NULL and swap the uniqueness rule. The backfill
-- FAILS LOUDLY rather than guess if the single-fixture assumption is violated.

-- 1. Add nullable so existing rows survive the ALTER.
ALTER TABLE "prediction_batches" ADD COLUMN "fixture_id" text;--> statement-breakpoint

-- 2. Backfill. Each batch's fixture derives from its predictions' questions.
--    Two special cases:
--    * A batch whose predictions span MORE THAN ONE fixture breaks the
--      single-fixture assumption. Splitting it would mean guessing how to
--      divide a real commitment, so the migration ABORTS for human review.
--    * A batch with ZERO predictions has no fixture to derive AND no user
--      commitment to preserve (an empty deck — nothing was predicted). It is
--      deleted: unambiguous, no prediction data lost. Empty batches are
--      created lazily (cohort ensureBatch) before the first prediction lands,
--      so a stray one is expected rather than exceptional.
DO $$
DECLARE
  multi_fixture_count integer;
BEGIN
  SELECT count(*) INTO multi_fixture_count FROM (
    SELECT pb.id
    FROM prediction_batches pb
    JOIN predictions p ON p.batch_id = pb.id
    JOIN questions q ON q.id = p.question_id
    GROUP BY pb.id
    HAVING count(DISTINCT q.fixture_id) > 1
  ) spanning;
  IF multi_fixture_count > 0 THEN
    RAISE EXCEPTION
      'per-fixture-batches: % batch(es) span multiple fixtures; single-fixture assumption violated — aborting for human review',
      multi_fixture_count;
  END IF;

  DELETE FROM prediction_batches pb
  WHERE NOT EXISTS (SELECT 1 FROM predictions p WHERE p.batch_id = pb.id);

  UPDATE prediction_batches pb
  SET fixture_id = derived.fixture_id
  FROM (
    SELECT DISTINCT pb2.id AS batch_id, q.fixture_id
    FROM prediction_batches pb2
    JOIN predictions p ON p.batch_id = pb2.id
    JOIN questions q ON q.id = p.question_id
  ) derived
  WHERE pb.id = derived.batch_id;
END $$;--> statement-breakpoint

-- 3. Now that every row is backfilled, enforce NOT NULL.
ALTER TABLE "prediction_batches" ALTER COLUMN "fixture_id" SET NOT NULL;--> statement-breakpoint

-- 4. Swap uniqueness: drop one-batch-per-participant, add per-fixture FK +
--    composite unique (participant, fixture).
ALTER TABLE "prediction_batches" DROP CONSTRAINT "prediction_batches_participant_id_unique";--> statement-breakpoint
ALTER TABLE "prediction_batches" ADD CONSTRAINT "prediction_batches_fixture_id_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_batches" ADD CONSTRAINT "prediction_batches_participant_fixture_unique" UNIQUE("participant_id","fixture_id");
