import crypto from 'crypto';
import pool from '../config/db';
import env from '../config/env';
import { AppError } from '../utils/appError';
import { getSmsProvider } from './sms';

export type OtpPurpose = 'signup' | 'login' | 'gate';

const CODE_TTL_MINUTES = 10;
const MAX_VERIFY_ATTEMPTS = 5;
const COOLDOWN_SECONDS = 60;     // between two sends to the same phone
const MAX_PER_PHONE_HOUR = 3;
const MAX_PER_PHONE_DAY = 8;

// Key for hashing codes. Derived so no extra secret has to be configured.
const hmacKey = crypto.createHash('sha256').update(`otp:${env.JWT_ACCESS_SECRET}`).digest();

export const hashCode = (phone: string, purpose: OtpPurpose, code: string) =>
  crypto.createHmac('sha256', hmacKey).update(`${phone}|${purpose}|${code}`).digest('hex');

const safeEqualHex = (a: string, b: string) =>
  a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * SMS costs money, so there are four independent ceilings (the per-IP one is a
 * route-level limiter in middleware/rateLimiters.ts):
 *   cooldown between sends · per phone per hour · per phone per day · site-wide per day
 */
const enforceSendLimits = async (phone: string) => {
  const { rows } = await pool.query(
    `SELECT
        count(*) FILTER (WHERE phone = $1 AND created_at > now() - interval '1 hour')::int AS phone_hour,
        count(*) FILTER (WHERE phone = $1 AND created_at > now() - interval '1 day')::int  AS phone_day,
        count(*)::int AS site_day,
        max(created_at) FILTER (WHERE phone = $1) < now() - ($2 || ' seconds')::interval AS cooled_down,
        bool_or(phone = $1) AS ever
       FROM otp_codes WHERE created_at > now() - interval '1 day'`,
    [phone, String(COOLDOWN_SECONDS)]
  );
  const r = rows[0];
  if (r.site_day >= env.OTP_DAILY_SMS_CAP) {
    throw new AppError('Text messages are temporarily unavailable. Please use email or try again later.', 503);
  }
  if (r.ever && r.cooled_down === false) {
    throw new AppError(`Please wait ${COOLDOWN_SECONDS} seconds before asking for another code.`, 429);
  }
  if (r.phone_hour >= MAX_PER_PHONE_HOUR || r.phone_day >= MAX_PER_PHONE_DAY) {
    throw new AppError('Too many codes were requested for this number. Please try again later.', 429);
  }
};

export const requestOtp = async (phone: string, purpose: OtpPurpose, ip?: string) => {
  await enforceSendLimits(phone);

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

  // Only the newest code is valid.
  await pool.query(
    `UPDATE otp_codes SET consumed_at = now() WHERE phone = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [phone, purpose]
  );
  const ins = await pool.query(
    `INSERT INTO otp_codes (phone, purpose, code_hash, expires_at, ip)
     VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval, $5) RETURNING id`,
    [phone, purpose, hashCode(phone, purpose, code), String(CODE_TTL_MINUTES), ip?.slice(0, 64) ?? null]
  );

  try {
    await getSmsProvider().send(phone, `Your AKILI code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes. Do not share it.`);
  } catch (err) {
    await pool.query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, [ins.rows[0].id]);
    console.error('SMS send failed:', (err as Error).message);
    throw new AppError('We could not send the text message. Please try again or use email.', 502);
  }
};

/** Returns true exactly once per valid code. */
export const verifyOtp = async (phone: string, purpose: OtpPurpose, code: string): Promise<boolean> => {
  const { rows } = await pool.query(
    `SELECT id, code_hash, attempts FROM otp_codes
      WHERE phone = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [phone, purpose]
  );
  const row = rows[0];
  if (!row) return false;

  // Count the attempt first, atomically, so parallel guesses cannot exceed the limit.
  const bumped = await pool.query(
    `UPDATE otp_codes SET attempts = attempts + 1
      WHERE id = $1 AND consumed_at IS NULL AND attempts < $2
      RETURNING attempts`,
    [row.id, MAX_VERIFY_ATTEMPTS]
  );
  if (bumped.rows.length === 0) return false;

  if (!safeEqualHex(row.code_hash, hashCode(phone, purpose, code))) {
    if (bumped.rows[0].attempts >= MAX_VERIFY_ATTEMPTS) {
      await pool.query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, [row.id]);
    }
    return false;
  }

  // Consume; if two requests race with the right code only one wins.
  const used = await pool.query(
    `UPDATE otp_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL`,
    [row.id]
  );
  return (used.rowCount ?? 0) === 1;
};
