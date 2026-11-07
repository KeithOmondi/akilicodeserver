import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../config/db';
import { AppError } from '../utils/appError';
import { sendToken } from '../utils/sendToken';
import { phoneVariants, toE164 } from '../validators/common';
import { requestOtp, verifyOtp } from '../services/otpService';
import { signGateToken, GATE_TTL_SECONDS } from '../services/tokens';

const GENERIC_SENT = { status: 'success', message: 'If the number can be used, a code is on its way by text message.' };

const findByPhone = async (e164: string) =>
  (await pool.query('SELECT * FROM users WHERE phone = ANY($1) LIMIT 1', [phoneVariants(e164)])).rows[0];

/** POST /auth/otp/request  { phone, purpose: 'signup' | 'login' } */
export const otpRequest = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone, purpose } = req.body as { phone: string; purpose: 'signup' | 'login' };
    const existing = await findByPhone(phone);

    if (purpose === 'signup') {
      if (existing) return next(new AppError('That number already has an account. Please log in instead.', 409));
      await requestOtp(phone, 'signup', req.ip);
      return res.status(200).json(GENERIC_SENT);
    }

    // login: say the same thing whether or not the number exists, and send no SMS
    // (no cost) for numbers that cannot log in this way. Admins always use a password.
    if (existing && existing.role === 'parent') {
      await requestOtp(phone, 'login', req.ip);
    }
    return res.status(200).json(GENERIC_SENT);
  } catch (error) {
    next(error);
  }
};

/** POST /auth/otp/verify  { phone, purpose, code, name?, accept_terms? } */
export const otpVerify = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone, purpose, code, name } = req.body as {
      phone: string; purpose: 'signup' | 'login'; code: string; name?: string;
    };

    const ok = await verifyOtp(phone, purpose, code);
    if (!ok) return next(new AppError('That code is wrong or has expired. Please request a new one.', 401));

    if (purpose === 'signup') {
      if (await findByPhone(phone)) return next(new AppError('That number already has an account.', 409));
      try {
        const created = await pool.query(
          `INSERT INTO users (name, phone, role, is_verified, phone_verified, phone_verified_at)
           VALUES ($1, $2, 'parent', true, true, now())
           RETURNING id, name, email, phone, role`,
          [name, phone]
        );
        return sendToken(created.rows[0], 201, res);
      } catch (e: any) {
        if (e?.code === '23505') return next(new AppError('That number already has an account.', 409));
        throw e;
      }
    }

    const user = await findByPhone(phone);
    if (!user || user.role !== 'parent') return next(new AppError('That code is wrong or has expired.', 401));
    if (!user.phone_verified) {
      await pool.query('UPDATE users SET phone_verified = true, phone_verified_at = now() WHERE id = $1', [user.id]);
    }
    return sendToken(user, 200, res);
  } catch (error) {
    next(error);
  }
};

// ── Parent gate ──────────────────────────────────────────────────────────────

/** POST /auth/parent-gate/otp — text a code to the logged-in parent's own number. */
export const gateOtpRequest = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query('SELECT phone FROM users WHERE id = $1', [req.user!.id]);
    const e164 = rows[0]?.phone ? toE164(rows[0].phone) : null;
    if (!e164) return next(new AppError('There is no phone number on this account. Please use your password.', 400));
    await requestOtp(e164, 'gate', req.ip);
    res.status(200).json(GENERIC_SENT);
  } catch (error) {
    next(error);
  }
};

/** POST /auth/parent-gate  { password } or { code } -> short-lived gate token */
export const parentGate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { password, code } = req.body as { password?: string; code?: string };
    const { rows } = await pool.query('SELECT id, password, phone FROM users WHERE id = $1', [req.user!.id]);
    const user = rows[0];
    if (!user) return next(new AppError('Account not found.', 404));

    let ok = false;
    if (password) {
      ok = !!user.password && (await bcrypt.compare(password, user.password));
    } else if (code) {
      const e164 = user.phone ? toE164(user.phone) : null;
      ok = !!e164 && (await verifyOtp(e164, 'gate', code));
    }
    if (!ok) return next(new AppError('That did not match. Please try again.', 401));

    res.status(200).json({
      status: 'success',
      data: { gateToken: signGateToken(user.id), expiresInSeconds: GATE_TTL_SECONDS },
    });
  } catch (error) {
    next(error);
  }
};
