import pool from '../config/db';

/**
 * Free trial: every child can try ONE course free for TRIAL_DAYS, no payment needed.
 *
 * How it works: a trial is a normal enrollment that is "active" only until enrollments.trial_ends_at.
 * Everything that lets a child open lessons already looks for an active enrollment, so it keeps working;
 * we only add the condition below so access stops exactly when the trial ends, even if the clean-up job is late.
 * When the parent pays, trial_ends_at is cleared and the enrollment is simply a paid one.
 */
export const TRIAL_DAYS = 7;

/**
 * SQL condition: "this enrollment is not a trial that has run out". Put it next to `status = 'active'`.
 * @param alias the table alias used in the query ("e"), or "" when the column is used bare.
 */
export const trialStillValid = (alias = 'e'): string => {
  const col = alias ? `${alias}.trial_ends_at` : 'trial_ends_at';
  return `(${col} IS NULL OR ${col} > now())`;
};

/**
 * Clean-up (also run by a background job): trials that ran out go back to "unpaid" so the parent can pay,
 * and the trial record is marked expired. Progress is never deleted. Returns how many trials ended.
 */
export const expireTrials = async (): Promise<number> => {
  const ended = await pool.query(
    `UPDATE enrollments
        SET status = 'pending'
      WHERE status = 'active' AND trial_ends_at IS NOT NULL AND trial_ends_at <= now()
      RETURNING kid_id, course_id`
  );
  await pool.query(`UPDATE trial_access SET status = 'expired', updated_at = now() WHERE status = 'active' AND expires_at <= now()`);
  return ended.rows.length;
};

/** Paying turns a trial into a normal enrollment. Call inside the transaction that marks the enrollment paid. */
export const clearTrialSql = `trial_ends_at = NULL`;
