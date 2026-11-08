-- 007_free_trial.sql
-- ADDITIVE: one new column, a better default and one index. Drops nothing. Safe to run more than once.

-- A free trial is an enrollment that is active only until this moment. NULL = not a trial (or it was paid for).
ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

-- Every course gets a 7-day trial. (Courses that were left on the old defaults of 3 or 5 days are moved to 7;
-- a number somebody chose on purpose is kept.)
ALTER TABLE courses ALTER COLUMN trial_duration_days SET DEFAULT 7;
UPDATE courses SET trial_duration_days = 7 WHERE trial_duration_days IS NULL OR trial_duration_days IN (3, 5);

-- One free trial per child. If old rows already break that rule the index is skipped (the app still checks).
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_trial_access_kid ON trial_access (kid_id);
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'uq_trial_access_kid skipped: some children already have more than one trial row';
END $$;
