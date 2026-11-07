import bcrypt from 'bcryptjs';
import pool from '../config/db';
import { AppError } from '../utils/appError';

// 5 wrong PINs in a row locks that child's login for 15 minutes.
export const KID_MAX_PIN_ATTEMPTS = 5;
export const KID_LOCK_MINUTES = 15;
const DUMMY_HASH = bcrypt.hashSync('0000', 10);

export type KidLoginRow = {
  id: string; parent_id: string; name: string; age: number; grade: string | null;
  avatar: string | null; username: string | null; pin_hash: string | null; pin_locked_until: Date | null;
  pin_reset_required?: boolean;
};

/**
 * Check a child's PIN with lockout. Resolves to the kid row on success, throws
 * AppError otherwise. Shared by the username login and the family-device picker.
 * Also refuses children whose consent was withdrawn.
 */
export const checkKidPin = async (
  kid: KidLoginRow | undefined,
  pin: string,
  ip?: string,
  /** The family-device picker already shows this child, so it may say a new PIN is needed. */
  explainReset = false
): Promise<KidLoginRow> => {
  if (explainReset && kid && !kid.pin_hash && kid.pin_reset_required) {
    const err = new AppError('Your PIN needs to be changed. Ask your grown-up to choose a new one.', 403);
    (err as AppError & { code?: string }).code = 'PIN_RESET_REQUIRED';
    throw err;
  }
  // Same timing and same message whether the child exists or not.
  if (!kid || !kid.pin_hash) {
    await bcrypt.compare(pin, DUMMY_HASH);
    throw new AppError('Incorrect PIN. Try again!', 401);
  }

  const locked = await pool.query(
    `SELECT pin_locked_until > now() AS locked,
            CEIL(EXTRACT(EPOCH FROM (pin_locked_until - now())) / 60)::int AS mins
       FROM kids WHERE id = $1`,
    [kid.id]
  );
  if (locked.rows[0]?.locked) {
    const mins = Math.max(1, locked.rows[0].mins);
    throw new AppError(`Too many tries. Ask a grown-up, or try again in ${mins} minute${mins === 1 ? '' : 's'}.`, 429);
  }

  const consent = await pool.query(
    `SELECT 1 FROM parental_consents WHERE kid_id = $1 AND withdrawn_at IS NULL LIMIT 1`,
    [kid.id]
  );
  // Children created before consent was recorded are treated as consented until
  // their parent re-confirms in the dashboard (see README "Consent").
  const hasAnyConsentRows = await pool.query(`SELECT 1 FROM parental_consents WHERE kid_id = $1 LIMIT 1`, [kid.id]);
  if (hasAnyConsentRows.rows.length > 0 && consent.rows.length === 0) {
    throw new AppError('This account is switched off. Ask your parent.', 403);
  }

  if (!(await bcrypt.compare(pin, kid.pin_hash))) {
    // Atomic: count the failure and lock once the limit is reached.
    const upd = await pool.query(
      `UPDATE kids
          SET pin_failed_attempts = COALESCE(pin_failed_attempts, 0) + 1,
              pin_locked_until = CASE
                WHEN COALESCE(pin_failed_attempts, 0) + 1 >= $2 THEN now() + ($3 || ' minutes')::interval
                ELSE pin_locked_until END
        WHERE id = $1
      RETURNING pin_locked_until > now() AS locked`,
      [kid.id, KID_MAX_PIN_ATTEMPTS, String(KID_LOCK_MINUTES)]
    );
    if (upd.rows[0]?.locked) {
      throw new AppError(`Too many tries. Ask a grown-up, or try again in ${KID_LOCK_MINUTES} minutes.`, 429);
    }
    throw new AppError('Incorrect PIN. Try again!', 401);
  }

  await pool.query(
    `UPDATE kids SET pin_failed_attempts = 0, pin_locked_until = NULL,
            last_kid_login_at = now(), last_kid_login_ip = $2 WHERE id = $1`,
    [kid.id, (ip ?? '').slice(0, 45)]
  );
  return kid;
};
