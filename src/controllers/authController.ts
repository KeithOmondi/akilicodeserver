import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import pool from '../config/db';
import env from '../config/env';
import { sendToken } from '../utils/sendToken';
import { AppError } from '../utils/appError';
import { IJWTPayload } from '../interfaces/user.interface';
import { buildResetPasswordLinkHtml, buildVerificationLinkHtml } from '../utils/mailsTemplate';
import sendMail from '../utils/sendMail';
import { phoneVariants } from '../validators/common';

// A valid bcrypt hash of a random string, used only to equalise login timing
// so the response time does not reveal whether an email is registered.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);
const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

/**
 * REGISTER
 * Body is validated by registerSchema ({ name, email, phone, password }).
 * `role` is intentionally NOT accepted: public sign-up always creates a parent.
 */
export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, password, phone } = req.body;

    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR phone = ANY($2)',
      [email, phoneVariants(phone)]
    );

    if (existingUser.rows.length > 0) {
      return next(new AppError('Email or Phone number already in use', 400));
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const newUser = await pool.query(
      `INSERT INTO users (name, email, password, phone, role, verification_token, otp_expires)
       VALUES ($1, $2, $3, $4, 'parent', $5, $6)
       RETURNING id, name, email, phone, role`,
      [name, email, hashedPassword, phone, verificationToken, tokenExpires]
    );

    const verificationUrl = `${env.FRONTEND_URL}/verify-email?token=${verificationToken}`;

    await sendMail({
      to: newUser.rows[0].email,
      subject: 'Verify your AkiliCode Account',
      text: `Welcome to AkiliCode! Please verify your account using this link: ${verificationUrl}`,
      html: buildVerificationLinkHtml({
        email: newUser.rows[0].email,
        name: newUser.rows[0].name,
        url: verificationUrl,
      }),
    });

    res.status(201).json({
      status: 'success',
      message: 'Registration successful! Please check your email to verify your account.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * VERIFY EMAIL LINK
 * GET /api/v1/auth/verify-email?token=...   (query validated by verifyEmailQuery)
 */
export const verifyEmail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.query;

    const result = await pool.query(
      'SELECT * FROM users WHERE verification_token = $1',
      [token]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Token is invalid or has expired.', 400));
    }

    const user = result.rows[0];

    if (user.is_verified) {
      return sendToken(user, 200, res);
    }

    if (new Date(user.otp_expires) < new Date()) {
      return next(new AppError('Verification link has expired. Please register again.', 400));
    }

    const updatedUser = await pool.query(
      `UPDATE users
       SET is_verified = true, verification_token = NULL, otp_expires = NULL
       WHERE id = $1
       RETURNING id, name, email, phone, role`,
      [user.id]
    );

    sendToken(updatedUser.rows[0], 200, res);
  } catch (error) {
    next(error);
  }
};

/**
 * LOGIN
 */
export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    // Always run a bcrypt compare, even for unknown emails.
    const passwordOk = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
    if (!user || !passwordOk) {
      return next(new AppError('Incorrect email or password', 401));
    }

    if (!user.is_verified) {
      return next(new AppError('Your email has not been verified. Please check your inbox.', 403));
    }

    sendToken(user, 200, res);
  } catch (error) {
    next(error);
  }
};

/**
 * REFRESH
 */
export const refresh = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.cookies;

    if (!refreshToken) {
      return next(new AppError('No refresh token found', 401));
    }

    const decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as IJWTPayload;

    const result = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.id]);
    const user = result.rows[0];

    if (!user || !user.is_verified) return next(new AppError('User no longer exists', 401));

    sendToken(user, 200, res);
  } catch (error) {
    return next(new AppError('Invalid or expired refresh token', 401));
  }
};

/**
 * FORGOT PASSWORD — emails a reset link.
 * Always answers the same way so the endpoint cannot be used to find out
 * which emails are registered. Only a SHA-256 hash of the token is stored.
 */
export const forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body;
    const GENERIC = {
      status: 'success',
      message: 'If that email is registered, a reset link is on its way.',
    };

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(200).json(GENERIC);
    }
    const user = result.rows[0];

    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      'UPDATE users SET password_reset_otp = $1, otp_expires = $2 WHERE id = $3',
      [sha256(resetToken), tokenExpires, user.id]
    );

    const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    await sendMail({
      to: user.email,
      subject: 'Reset your AkiliCode Password',
      text: `You requested a password reset. Click this link to reset your password: ${resetUrl}. This link expires in 1 hour.`,
      html: buildResetPasswordLinkHtml({
        email: user.email,
        name: user.name,
        url: resetUrl,
      }),
    });

    res.status(200).json(GENERIC);
  } catch (error) {
    next(error);
  }
};

/**
 * RESET PASSWORD — accepts the token from the link + a new password
 */
export const resetPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, newPassword } = req.body;

    const result = await pool.query(
      'SELECT * FROM users WHERE password_reset_otp = $1 AND otp_expires > NOW()',
      [sha256(token)]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Reset link is invalid or has expired.', 400));
    }

    const user = result.rows[0];
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await pool.query(
      'UPDATE users SET password = $1, password_reset_otp = NULL, otp_expires = NULL WHERE id = $2',
      [hashedPassword, user.id]
    );

    res.status(200).json({
      status: 'success',
      message: 'Password reset successfully. You can now log in.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * UPDATE PASSWORD (LOGGED IN)
 */
export const updatePassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return next(new AppError('You are not logged in', 401));
    }

    const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];

    if (!user) {
      return next(new AppError('User no longer exists', 404));
    }

    if (!user.password) {
      return next(new AppError('This account signs in with a text-message code and has no password.', 400));
    }
    if (!(await bcrypt.compare(currentPassword, user.password))) {
      return next(new AppError('Incorrect current password', 401));
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    const updatedResult = await pool.query(
      'UPDATE users SET password = $1 WHERE id = $2 RETURNING *',
      [hashedPassword, userId]
    );

    sendToken(updatedResult.rows[0], 200, res);
  } catch (error) {
    next(error);
  }
};

/**
 * LOGOUT
 */
export const logout = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.clearCookie('refreshToken', {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.IS_PRODUCTION,
    });

    res.status(200).json({
      status: 'success',
      message: 'Logged out successfully.',
    });
  } catch (error) {
    next(error);
  }
};
