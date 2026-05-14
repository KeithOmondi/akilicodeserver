// controllers/userController.ts
import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/db';
import { AppError } from '../utils/appError';
import { IUser, IJWTPayload } from '../interfaces/user.interface';
import { IKid, KidLoginPayload, SetKidLoginPayload } from '../interfaces/kid.interface';
import { auditLog } from '../service/auditService';
import { sendParentalConsentEmail, sendVerificationEmail } from '../utils/mailsTemplate';
import * as crypto from 'crypto';
import env from '../config/env';

const SALT_ROUNDS = 12;
const JWT_ACCESS_SECRET = env.JWT_ACCESS_SECRET!;
const KID_SESSION_MINUTES = 120;

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const calculateAge = (birthDate: Date): number => {
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
};

const validateKidPin = (pin: string): void => {
  if (!pin || !/^\d{4,8}$/.test(pin)) {
    throw new AppError('PIN must be 4-8 digits', 400);
  }
  const sequential = ['0123', '1234', '2345', '3456', '4567', '5678', '6789', '7890'];
  if (sequential.some(seq => pin.includes(seq))) {
    throw new AppError('PIN cannot contain sequential digits', 400);
  }
  if (/^(\d)\1+$/.test(pin)) {
    throw new AppError('PIN cannot be all the same digit', 400);
  }
};

const generateParentToken = (user: IUser): string => {
  const payload: IJWTPayload = {
    id: user.id,
    name: user.name,
    role: 'parent',
    phone: user.phone,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60)
  };
  return jwt.sign(payload, JWT_ACCESS_SECRET);
};

const generateKidToken = (kid: IKid, parentId: string): string => {
  const payload: IJWTPayload = {
    id: kid.id,
    name: kid.name,
    role: 'kid',
    kid_id: kid.id,
    parent_id: parentId,
    username: kid.username,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (KID_SESSION_MINUTES * 60)
  };
  return jwt.sign(payload, JWT_ACCESS_SECRET);
};

// ─── PUBLIC AUTH ──────────────────────────────────────────────────────────────

export const registerParent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, phone, password, birthDate } = req.body;

    if (!name || !email || !phone || !password || !birthDate) {
      return next(new AppError('Please provide all required fields.', 400));
    }

    const age = calculateAge(new Date(birthDate));
    if (age < 18) {
      return next(new AppError('You must be at least 18 years old to register as a parent.', 400));
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return next(new AppError('Email already registered.', 400));
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const verificationToken = uuidv4();
    const id = uuidv4();

    const result = await pool.query(
      `INSERT INTO users 
        (id, name, email, phone, password, role, is_verified, two_factor_enabled, 
         login_attempts, email_verification_token, created_at)
       VALUES ($1, $2, $3, $4, $5, 'parent', false, false, 0, $6, NOW())
       RETURNING id, name, email, phone, role, is_verified, created_at`,
      [id, name, email, phone, hashedPassword, verificationToken]
    );

    await sendVerificationEmail({ email, name, token: verificationToken });
    await auditLog('PARENT_REGISTERED', id, { email, age }, req.ip, req.headers['user-agent'] as string);

    res.status(201).json({
      status: 'success',
      message: 'Registration successful! Please check your email to verify your account.',
      data: { user: result.rows[0] }
    });
  } catch (error) {
    next(error);
  }
};

export const loginParent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return next(new AppError('Please provide email and password.', 400));
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1 AND role = $2', [email, 'parent']);
    const user = result.rows[0];

    if (!user) return next(new AppError('Invalid credentials.', 401));

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return next(new AppError(`Account locked until ${new Date(user.locked_until).toLocaleString()}`, 403));
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      const attempts = (user.login_attempts || 0) + 1;
      const lockedUntil = attempts >= 5 ? new Date(Date.now() + 30 * 60 * 1000) : null;
      await pool.query(
        'UPDATE users SET login_attempts = $1, locked_until = $2 WHERE id = $3',
        [attempts, lockedUntil, user.id]
      );
      return next(new AppError('Invalid credentials.', 401));
    }

    if (!user.is_verified) {
      return next(new AppError('Please verify your email before logging in.', 403));
    }

    await pool.query(
      'UPDATE users SET login_attempts = 0, locked_until = NULL, last_login_at = NOW(), last_login_ip = $1 WHERE id = $2',
      [req.ip, user.id]
    );

    const token = generateParentToken(user);
    await auditLog('PARENT_LOGIN', user.id, { email }, req.ip);

    res.status(200).json({
      status: 'success',
      data: { user, token }
    });
  } catch (error) {
    next(error);
  }
};

export const verifyEmail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.params;

    const result = await pool.query(
      'SELECT * FROM users WHERE email_verification_token = $1',
      [token]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Invalid or expired verification token.', 400));
    }

    await pool.query(
      'UPDATE users SET is_verified = true, email_verification_token = NULL WHERE id = $1',
      [result.rows[0].id]
    );

    await auditLog('EMAIL_VERIFIED', result.rows[0].id, { email: result.rows[0].email });

    res.status(200).json({ status: 'success', message: 'Email verified successfully.' });
  } catch (error) {
    next(error);
  }
};

export const resendVerification = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body;

    const result = await pool.query('SELECT * FROM users WHERE email = $1 AND role = $2', [email, 'parent']);
    if (result.rows.length === 0) return next(new AppError('User not found.', 404));

    const user = result.rows[0];
    if (user.is_verified) return next(new AppError('Email already verified.', 400));

    const newToken = uuidv4();
    await pool.query('UPDATE users SET email_verification_token = $1 WHERE id = $2', [newToken, user.id]);
    await sendVerificationEmail({ email, name: user.name, token: newToken });
    await auditLog('VERIFICATION_EMAIL_RESENT', user.id, { email });

    res.status(200).json({ status: 'success', message: 'Verification email sent.' });
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body;

    const result = await pool.query('SELECT * FROM users WHERE email = $1 AND role = $2', [email, 'parent']);
    if (result.rows.length === 0) {
      return res.status(200).json({ status: 'success', message: 'If that email exists, a reset link has been sent.' });
    }

    const user = result.rows[0];
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 3600000);

    await pool.query(
      'UPDATE users SET reset_password_token = $1, reset_password_expires = $2 WHERE id = $3',
      [resetToken, resetExpires, user.id]
    );

    await auditLog('PASSWORD_RESET_REQUESTED', user.id, { email });

    res.status(200).json({ status: 'success', message: 'If that email exists, a reset link has been sent.' });
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    const result = await pool.query(
      'SELECT * FROM users WHERE reset_password_token = $1 AND reset_password_expires > NOW()',
      [token]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Invalid or expired reset token.', 400));
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    await pool.query(
      'UPDATE users SET password = $1, reset_password_token = NULL, reset_password_expires = NULL WHERE id = $2',
      [hashedPassword, result.rows[0].id]
    );

    await auditLog('PASSWORD_RESET_SUCCESS', result.rows[0].id, { email: result.rows[0].email });

    res.status(200).json({ status: 'success', message: 'Password reset successfully.' });
  } catch (error) {
    next(error);
  }
};

// ─── KID AUTH ─────────────────────────────────────────────────────────────────

export const loginKid = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, pin }: KidLoginPayload = req.body;

    const kidResult = await pool.query('SELECT * FROM kids WHERE username = $1', [username]);
    const kid = kidResult.rows[0];

    if (!kid || !kid.hashed_pin) {
      return next(new AppError('Invalid username or PIN.', 401));
    }

    if (kid.pin_locked_until && new Date(kid.pin_locked_until) > new Date()) {
      return next(new AppError(`Account locked until ${new Date(kid.pin_locked_until).toLocaleString()}`, 403));
    }

    const parentResult = await pool.query('SELECT id FROM users WHERE id = $1', [kid.parent_id]);
    if (parentResult.rows.length === 0) {
      return next(new AppError('Parent account not found.', 404));
    }

    const consentResult = await pool.query(
      'SELECT id FROM parental_consent WHERE kid_id = $1 AND revoked_at IS NULL',
      [kid.id]
    );
    if (consentResult.rows.length === 0) {
      return next(new AppError('Parental consent has been revoked. Please ask your parent to re-activate your account.', 403));
    }

    const isValidPin = await bcrypt.compare(pin, kid.hashed_pin);
    if (!isValidPin) {
      const attempts = (kid.pin_failed_attempts || 0) + 1;
      const lockedUntil = attempts >= 5 ? new Date(Date.now() + 30 * 60 * 1000) : null;
      await pool.query(
        'UPDATE kids SET pin_failed_attempts = $1, pin_locked_until = $2 WHERE id = $3',
        [attempts, lockedUntil, kid.id]
      );
      return next(new AppError('Invalid PIN.', 401));
    }

    await pool.query(
      'UPDATE kids SET pin_failed_attempts = 0, pin_locked_until = NULL, last_kid_login_at = NOW(), last_kid_login_ip = $1 WHERE id = $2',
      [req.ip, kid.id]
    );

    await pool.query('DELETE FROM kid_sessions WHERE kid_id = $1', [kid.id]);

    const token = generateKidToken(kid, kid.parent_id);
    await pool.query(
      `INSERT INTO kid_sessions (id, kid_id, parent_id, session_token, created_at, expires_at, ip_address)
       VALUES ($1, $2, $3, $4, NOW(), $5, $6)`,
      [uuidv4(), kid.id, kid.parent_id, token, new Date(Date.now() + KID_SESSION_MINUTES * 60 * 1000), req.ip]
    );

    await auditLog('KID_LOGIN', kid.parent_id, { kid_id: kid.id, username: kid.username }, req.ip);

    const { hashed_pin, ...kidWithoutPin } = kid;

    res.status(200).json({
      status: 'success',
      data: { kid: kidWithoutPin, token }
    });
  } catch (error) {
    next(error);
  }
};

export const logoutKid = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      await pool.query('DELETE FROM kid_sessions WHERE session_token = $1', [token]);
    }
    res.status(200).json({ status: 'success', message: 'Logged out successfully.' });
  } catch (error) {
    next(error);
  }
};

// ─── PARENT PROFILE ───────────────────────────────────────────────────────────

export const getParentProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = (req.user as IUser).id;

    const result = await pool.query(
      'SELECT id, name, email, phone, role, is_verified, two_factor_enabled, created_at FROM users WHERE id = $1',
      [parentId]
    );

    if (result.rows.length === 0) return next(new AppError('Parent not found.', 404));

    res.status(200).json({ status: 'success', data: { parent: result.rows[0] } });
  } catch (error) {
    next(error);
  }
};

export const updateParentProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = (req.user as IUser).id;
    const { name, phone } = req.body;

    const result = await pool.query(
      `UPDATE users SET 
        name = COALESCE($1, name), 
        phone = COALESCE($2, phone)
       WHERE id = $3
       RETURNING id, name, email, phone, role`,
      [name, phone, parentId]
    );

    await auditLog('PARENT_PROFILE_UPDATED', parentId, { name, phone });

    res.status(200).json({ status: 'success', data: { parent: result.rows[0] } });
  } catch (error) {
    next(error);
  }
};

export const changePassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = (req.user as IUser).id;
    const { currentPassword, newPassword } = req.body;

    const result = await pool.query('SELECT * FROM users WHERE id = $1', [parentId]);
    const user = result.rows[0];

    if (!user) return next(new AppError('User not found.', 404));

    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) return next(new AppError('Current password is incorrect.', 401));

    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, parentId]);

    const kids = await pool.query('SELECT id FROM kids WHERE parent_id = $1', [parentId]);
    for (const kid of kids.rows) {
      await pool.query('DELETE FROM kid_sessions WHERE kid_id = $1', [kid.id]);
    }

    await auditLog('PASSWORD_CHANGED', parentId, {});

    res.status(200).json({ status: 'success', message: 'Password changed successfully.' });
  } catch (error) {
    next(error);
  }
};

export const requestAccountDeletion = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = (req.user as IUser).id;

    await pool.query('UPDATE users SET deletion_requested_at = NOW() WHERE id = $1', [parentId]);
    await auditLog('ACCOUNT_DELETION_REQUESTED', parentId, {});

    res.status(200).json({ status: 'success', message: 'Account deletion requested. Data will be removed per retention policy.' });
  } catch (error) {
    next(error);
  }
};

// ─── TWO-FACTOR AUTH ──────────────────────────────────────────────────────────

export const enableTwoFactor = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = (req.user as IUser).id;

    await pool.query('UPDATE users SET two_factor_enabled = true WHERE id = $1', [parentId]);
    await auditLog('TWO_FACTOR_ENABLED', parentId, {});

    res.status(200).json({ status: 'success', message: 'Two-factor authentication enabled.' });
  } catch (error) {
    next(error);
  }
};

export const disableTwoFactor = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = (req.user as IUser).id;
    const { password } = req.body;

    const result = await pool.query('SELECT * FROM users WHERE id = $1', [parentId]);
    const isValid = await bcrypt.compare(password, result.rows[0].password);
    if (!isValid) return next(new AppError('Incorrect password.', 401));

    await pool.query(
      'UPDATE users SET two_factor_enabled = false, two_factor_secret = NULL WHERE id = $1',
      [parentId]
    );
    await auditLog('TWO_FACTOR_DISABLED', parentId, {});

    res.status(200).json({ status: 'success', message: 'Two-factor authentication disabled.' });
  } catch (error) {
    next(error);
  }
};

// ─── KID MANAGEMENT ───────────────────────────────────────────────────────────

export const createKidAccount = async (req: Request, res: Response, next: NextFunction) => {
  const client = await pool.connect();
  try {
    const parentId = (req.user as IUser).id;
    const { name, username, pin, age, grade, avatar }: SetKidLoginPayload & { name: string; age?: number; grade?: string; avatar?: string } = req.body;

    const parent = await client.query('SELECT * FROM users WHERE id = $1 AND role = $2', [parentId, 'parent']);
    if (parent.rows.length === 0) return next(new AppError('Parent not found.', 404));
    if (!parent.rows[0].is_verified) return next(new AppError('Parent email must be verified before creating kid accounts.', 403));

    if (age && age >= 13) {
      return next(new AppError('Kid accounts are for children under 13.', 400));
    }

    const existingUsername = await client.query('SELECT id FROM kids WHERE username = $1', [username]);
    if (existingUsername.rows.length > 0) return next(new AppError('Username already taken.', 400));

    validateKidPin(pin);

    const hashedPin = await bcrypt.hash(pin, SALT_ROUNDS);
    const kidId = uuidv4();

    await client.query('BEGIN');

    const kidResult = await client.query(
      `INSERT INTO kids (id, parent_id, name, role, age, grade, avatar, username, hashed_pin, has_pin, created_at)
       VALUES ($1, $2, $3, 'kid', $4, $5, $6, $7, $8, true, NOW())
       RETURNING id, parent_id, name, role, age, grade, avatar, username, has_pin, created_at`,
      [kidId, parentId, name, age || 0, grade || null, avatar || null, username, hashedPin]
    );

    const consentResult = await client.query(
      `INSERT INTO parental_consent 
        (id, parent_id, kid_id, method, method_details, granted_at, granted_ip, user_agent,
         version_of_policy, coppa_compliant, consented_to_analytics, consented_to_third_party,
         consented_to_personalization, consented_to_ip_collection)
       VALUES ($1, $2, $3, 'email_plus', $4, NOW(), $5, $6, $7, true, true, false, true, true)
       RETURNING *`,
      [
        uuidv4(), parentId, kidId,
        'Consent provided via parent account creation flow',
        req.ip, req.headers['user-agent'] || '',
        '2025-06-23-v2'
      ]
    );

    await client.query('COMMIT');

    await auditLog('KID_ACCOUNT_CREATED', parentId, { kid_id: kidId, username }, req.ip, req.headers['user-agent'] as string);

    await sendParentalConsentEmail({
      parentEmail: parent.rows[0].email,
      parentName: parent.rows[0].name,
      kidName: name,
      kidUsername: username,
      consentMethod: 'email_plus',
      consentDate: new Date(),
      dashboardUrl: `${process.env.APP_URL}/parent/dashboard`
    });

    res.status(201).json({
      status: 'success',
      data: { kid: kidResult.rows[0], consent: consentResult.rows[0] }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

export const getParentKids = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = (req.user as IUser).id;

    const result = await pool.query(
      'SELECT id, parent_id, name, role, age, grade, avatar, username, has_pin, created_at FROM kids WHERE parent_id = $1 ORDER BY created_at ASC',
      [parentId]
    );

    res.status(200).json({ status: 'success', results: result.rows.length, data: { kids: result.rows } });
  } catch (error) {
    next(error);
  }
};

export const getKidById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = (req.user as IUser).id;
    const { kidId } = req.params;

    const result = await pool.query(
      'SELECT id, parent_id, name, role, age, grade, avatar, username, has_pin, created_at FROM kids WHERE id = $1 AND parent_id = $2',
      [kidId, parentId]
    );

    if (result.rows.length === 0) return next(new AppError('Kid not found.', 404));

    res.status(200).json({ status: 'success', data: { kid: result.rows[0] } });
  } catch (error) {
    next(error);
  }
};

export const updateKidProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = (req.user as IUser).id;
    const { kidId } = req.params;
    const { name, grade, avatar } = req.body;

    const result = await pool.query(
      `UPDATE kids SET
        name = COALESCE($1, name),
        grade = COALESCE($2, grade),
        avatar = COALESCE($3, avatar)
       WHERE id = $4 AND parent_id = $5
       RETURNING id, parent_id, name, role, age, grade, avatar, username, has_pin, created_at`,
      [name, grade, avatar, kidId, parentId]
    );

    if (result.rows.length === 0) return next(new AppError('Kid not found.', 404));

    await auditLog('KID_PROFILE_UPDATED', parentId, { kid_id: kidId });

    res.status(200).json({ status: 'success', data: { kid: result.rows[0] } });
  } catch (error) {
    next(error);
  }
};

export const deleteKidAccount = async (req: Request, res: Response, next: NextFunction) => {
  const client = await pool.connect();
  try {
    const parentId = (req.user as IUser).id;
    const { kidId } = req.params;

    const kidCheck = await client.query('SELECT id FROM kids WHERE id = $1 AND parent_id = $2', [kidId, parentId]);
    if (kidCheck.rows.length === 0) return next(new AppError('Kid not found.', 404));

    await client.query('BEGIN');
    await client.query('DELETE FROM kid_sessions WHERE kid_id = $1', [kidId]);
    await client.query('DELETE FROM kid_activity WHERE kid_id = $1', [kidId]);
    await client.query(
      `UPDATE parental_consent SET revoked_at = NOW(), revoked_reason = 'Parent requested deletion' WHERE kid_id = $1`,
      [kidId]
    );
    await client.query('DELETE FROM kids WHERE id = $1', [kidId]);
    await client.query('COMMIT');

    await auditLog('KID_ACCOUNT_DELETED', parentId, { kid_id: kidId });

    res.status(200).json({ status: 'success', message: 'Kid account deleted.' });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

// ─── KID PIN & SESSION ────────────────────────────────────────────────────────

export const updateKidPin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = (req.user as IUser).id;
    const { kidId } = req.params;
    const { pin } = req.body;

    const kidCheck = await pool.query('SELECT id FROM kids WHERE id = $1 AND parent_id = $2', [kidId, parentId]);
    if (kidCheck.rows.length === 0) return next(new AppError('Kid not found.', 404));

    validateKidPin(pin);
    const hashedPin = await bcrypt.hash(pin, SALT_ROUNDS);

    await pool.query('UPDATE kids SET hashed_pin = $1, has_pin = true WHERE id = $2', [hashedPin, kidId]);
    await pool.query('DELETE FROM kid_sessions WHERE kid_id = $1', [kidId]);
    await auditLog('KID_PIN_UPDATED', parentId, { kid_id: kidId });

    res.status(200).json({ status: 'success', message: 'PIN updated successfully.' });
  } catch (error) {
    next(error);
  }
};

export const unlockKidPin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = (req.user as IUser).id;
    const { kidId } = req.params;

    const kidCheck = await pool.query('SELECT id FROM kids WHERE id = $1 AND parent_id = $2', [kidId, parentId]);
    if (kidCheck.rows.length === 0) return next(new AppError('Kid not found.', 404));

    await pool.query(
      'UPDATE kids SET pin_failed_attempts = 0, pin_locked_until = NULL WHERE id = $1',
      [kidId]
    );
    await auditLog('KID_PIN_UNLOCKED', parentId, { kid_id: kidId });

    res.status(200).json({ status: 'success', message: 'Kid PIN unlocked.' });
  } catch (error) {
    next(error);
  }
};

export const updateKidSessionTimeout = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = (req.user as IUser).id;
    const { kidId } = req.params;
    const { session_timeout_minutes } = req.body;

    const kidCheck = await pool.query('SELECT id FROM kids WHERE id = $1 AND parent_id = $2', [kidId, parentId]);
    if (kidCheck.rows.length === 0) return next(new AppError('Kid not found.', 404));

    await pool.query('UPDATE kids SET session_timeout_minutes = $1 WHERE id = $2', [session_timeout_minutes, kidId]);
    await auditLog('KID_SESSION_TIMEOUT_UPDATED', parentId, { kid_id: kidId, session_timeout_minutes });

    res.status(200).json({ status: 'success', message: 'Session timeout updated.' });
  } catch (error) {
    next(error);
  }
};

// ─── CONSENT ──────────────────────────────────────────────────────────────────

export const revokeConsent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = (req.user as IUser).id;
    const { kidId } = req.params;

    const kidCheck = await pool.query('SELECT id FROM kids WHERE id = $1 AND parent_id = $2', [kidId, parentId]);
    if (kidCheck.rows.length === 0) return next(new AppError('Kid not found.', 404));

    await pool.query(
      `UPDATE parental_consent SET revoked_at = NOW(), revoked_reason = 'Parent revoked consent' WHERE kid_id = $1`,
      [kidId]
    );
    await pool.query('DELETE FROM kid_sessions WHERE kid_id = $1', [kidId]);
    await auditLog('CONSENT_REVOKED', parentId, { kid_id: kidId });

    res.status(200).json({ status: 'success', message: 'Consent revoked.' });
  } catch (error) {
    next(error);
  }
};

export const updateGranularConsent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = (req.user as IUser).id;
    const { kidId } = req.params;
    const { analytics, third_party, personalization, ip_collection } = req.body;

    const kidCheck = await pool.query('SELECT id FROM kids WHERE id = $1 AND parent_id = $2', [kidId, parentId]);
    if (kidCheck.rows.length === 0) return next(new AppError('Kid not found.', 404));

    const result = await pool.query(
      `UPDATE parental_consent SET
        consented_to_analytics = COALESCE($1, consented_to_analytics),
        consented_to_third_party = COALESCE($2, consented_to_third_party),
        consented_to_personalization = COALESCE($3, consented_to_personalization),
        consented_to_ip_collection = COALESCE($4, consented_to_ip_collection)
       WHERE kid_id = $5 AND revoked_at IS NULL
       RETURNING *`,
      [analytics, third_party, personalization, ip_collection, kidId]
    );

    await auditLog('GRANULAR_CONSENT_UPDATED', parentId, { kid_id: kidId });

    res.status(200).json({ status: 'success', data: { consent: result.rows[0] } });
  } catch (error) {
    next(error);
  }
};

// ─── KID ACTIVITY ─────────────────────────────────────────────────────────────

export const getKidActivity = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = (req.user as IUser).id;
    const { kidId } = req.params;

    const kidCheck = await pool.query('SELECT id FROM kids WHERE id = $1 AND parent_id = $2', [kidId, parentId]);
    if (kidCheck.rows.length === 0) return next(new AppError('Kid not found.', 404));

    const result = await pool.query(
      'SELECT * FROM kid_activity WHERE kid_id = $1 ORDER BY created_at DESC LIMIT 100',
      [kidId]
    );

    res.status(200).json({ status: 'success', results: result.rows.length, data: { activity: result.rows } });
  } catch (error) {
    next(error);
  }
};

// ─── ADMIN ────────────────────────────────────────────────────────────────────

export const getAllUsers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, phone, role, is_verified, created_at FROM users ORDER BY created_at DESC'
    );
    res.status(200).json({ status: 'success', results: result.rows.length, data: { users: result.rows } });
  } catch (error) {
    next(error);
  }
};

export const getUserById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, phone, role, is_verified, created_at FROM users WHERE id = $1',
      [req.params.userId]
    );
    if (result.rows.length === 0) return next(new AppError('User not found.', 404));
    res.status(200).json({ status: 'success', data: { user: result.rows[0] } });
  } catch (error) {
    next(error);
  }
};

export const updateUserRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { role } = req.body;
    const result = await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, name, email, role',
      [role, req.params.userId]
    );
    if (result.rows.length === 0) return next(new AppError('User not found.', 404));
    res.status(200).json({ status: 'success', data: { user: result.rows[0] } });
  } catch (error) {
    next(error);
  }
};

export const adminDeleteUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [req.params.userId]);
    if (result.rows.length === 0) return next(new AppError('User not found.', 404));
    res.status(200).json({ status: 'success', message: 'User deleted.' });
  } catch (error) {
    next(error);
  }
};