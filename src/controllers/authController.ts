import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../config/db';
import env from '../config/env';
import { sendToken } from '../utils/sendToken';
import { AppError } from '../utils/appError';
import { IJWTPayload } from '../interfaces/user.interface';
import { sendEmail } from '../utils/sendMail';
import { buildResetPasswordLinkHtml, buildVerificationLinkHtml } from '../utils/mailsTemplate';
import crypto from 'crypto';

/**
 * REGISTER
 */
export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, password, phone, role } = req.body;

    // 1. Basic Validation
    if (!name || !email || !password || !phone) {
      return next(new AppError('Please provide name, email, password, and phone number', 400));
    }

    // 2. Check if user exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR phone = $2',
      [email, phone]
    );

    if (existingUser.rows.length > 0) {
      return next(new AppError('Email or Phone number already in use', 400));
    }

    // 3. Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // 4. Generate Verification Token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 Hours

    // 5. Insert user (is_verified defaults to false)
    const userRole = role === 'admin' ? 'admin' : 'parent';

    const newUser = await pool.query(
      `INSERT INTO users (name, email, password, phone, role, verification_token, otp_expires) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING id, name, email, phone, role`,
      [name, email, hashedPassword, phone, userRole, verificationToken, tokenExpires]
    );

    // 6. Construct Verification URL
    // Ensure FRONTEND_URL is defined in your .env (e.g., http://localhost:3000)
    const verificationUrl = `${env.ALLOWED_ORIGIN}/verify-email?token=${verificationToken}`;

    // 7. Send Email
    await sendEmail({
      email: newUser.rows[0].email,
      subject: 'Verify your AkiliCode Account',
      message: `Welcome to AkiliCode! Please verify your account using this link: ${verificationUrl}`,
      html: buildVerificationLinkHtml({
        email: newUser.rows[0].email,
        name: newUser.rows[0].name,
        url: verificationUrl,
      }),
    });

    // 8. Respond (Do NOT send tokens yet)
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
 * GET /api/v1/auth/verify-email?token=...
 */
export const verifyEmail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.query;

    if (!token) {
      return next(new AppError('Invalid or missing verification token.', 400));
    }

    // Check if already verified with this token
    const result = await pool.query(
      'SELECT * FROM users WHERE verification_token = $1',
      [token]
    );

    // Token doesn't exist at all
    if (result.rows.length === 0) {
      return next(new AppError('Token is invalid or has expired.', 400));
    }

    const user = result.rows[0];

    // Already verified — just log them in instead of erroring
    if (user.is_verified) {
      return sendToken(user, 200, res);
    }

    // Check expiry
    if (new Date(user.otp_expires) < new Date()) {
      return next(new AppError('Verification link has expired. Please register again.', 400));
    }

    // Mark as verified
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

    if (!email || !password) {
      return next(new AppError('Please provide email and password', 400));
    }

    // 1. Find user
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    // 2. Check password
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return next(new AppError('Incorrect email or password', 401));
    }

    // 3. CHECK VERIFICATION STATUS (The missing piece)
    // Assuming your column name is 'is_verified'
    if (!user.is_verified) {
      return next(new AppError('Your email has not been verified. Please check your inbox.', 403));
    }

    // 4. Send Tokens
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

    if (!user) return next(new AppError('User no longer exists', 401));

    sendToken(user, 200, res);
  } catch (error) {
    return next(new AppError('Invalid or expired refresh token', 401));
  }
};

/**
 * FORGOT PASSWORD — sends a reset link just like verification
 */
export const forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body;

    if (!email) return next(new AppError('Email address is required', 400));

    // 1. Find user
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      return next(new AppError('No user found with this email address', 404));
    }

    const user = result.rows[0];

    // 2. Generate reset token + expiry (same pattern as verification)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // 3. Save token to DB
    await pool.query(
      'UPDATE users SET password_reset_otp = $1, otp_expires = $2 WHERE id = $3',
      [resetToken, tokenExpires, user.id]
    );

    // 4. Build reset URL — matches your frontend route
    const resetUrl = `${env.ALLOWED_ORIGIN}/reset-password?token=${resetToken}`;

    // 5. Send email
    await sendEmail({
      email: user.email,
      subject: 'Reset your AkiliCode Password',
      message: `You requested a password reset. Click this link to reset your password: ${resetUrl}. This link expires in 1 hour.`,
      html: buildResetPasswordLinkHtml({
        email: user.email,
        name: user.name,
        url: resetUrl,
      }),
    });

    res.status(200).json({
      status: 'success',
      message: 'Password reset link sent to your email address.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * RESET PASSWORD — accepts token from the link + new password
 */
export const resetPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return next(new AppError('Token and new password are required.', 400));
    }

    // 1. Find user with valid token
    const result = await pool.query(
      'SELECT * FROM users WHERE password_reset_otp = $1 AND otp_expires > NOW()',
      [token]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Reset link is invalid or has expired.', 400));
    }

    const user = result.rows[0];

    // 2. Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // 3. Update password and clear token
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
/**
 * UPDATE PASSWORD (LOGGED IN)
 */
export const updatePassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Use a type guard or cast to bypass the 'Property user does not exist' error
    const userId = (req as any).user?.id;

    if (!userId) {
      return next(new AppError('You are not logged in', 401));
    }

    // 1. Fetch user including password
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];

    if (!user) {
      return next(new AppError('User no longer exists', 404));
    }

    // 2. Check current password
    if (!(await bcrypt.compare(currentPassword, user.password))) {
      return next(new AppError('Incorrect current password', 401));
    }

    // 3. Hash new password and update
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
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
    });

    res.status(200).json({
      status: 'success',
      message: 'Logged out successfully.',
    });
  } catch (error) {
    next(error);
  }
};