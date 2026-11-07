import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { AppError } from '../utils/appError';
import bcrypt from 'bcryptjs';
import { sendToken } from '../utils/sendToken';

// ─── REGISTER A KID ───────────────────────────────────────────────────────────

// ─── GET MY KIDS ──────────────────────────────────────────────────────────────

// ─── GET A SINGLE KID ─────────────────────────────────────────────────────────

export const getKidById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = req.user?.id;
    if (!parentId) return next(new AppError('Unauthorized access.', 401));

    const { kidId } = req.params;

    const result = await pool.query(
      `SELECT id, parent_id, name, age, grade, avatar, username,
              CASE WHEN pin_hash IS NOT NULL THEN true ELSE false END AS has_pin,
              created_at
       FROM kids
       WHERE id = $1 AND parent_id = $2`,
      [kidId, parentId]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Kid not found or does not belong to you.', 404));
    }

    res.status(200).json({
      status: 'success',
      data: { kid: result.rows[0] },
    });
  } catch (error) {
    next(error);
  }
};

// ─── SET KID LOGIN (parent sets username + PIN) ───────────────────────────────

export const setKidLogin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user;
    if (!user || user.role === 'kid') {
      return next(new AppError('Only parents can set kid login credentials.', 403));
    }

    const parentId = user.id;
    const { kidId } = req.params;
    const { username, pin } = req.body;

    if (!username || !pin) {
      return next(new AppError('Please provide a username and PIN.', 400));
    }

    if (!/^\d{4}$/.test(pin)) {
      return next(new AppError('PIN must be exactly 4 digits.', 400));
    }

    const usernameCheck = await pool.query(
      'SELECT id FROM kids WHERE username = $1 AND id != $2',
      [username.toLowerCase().trim(), kidId]
    );

    if (usernameCheck.rows.length > 0) {
      return next(new AppError('That username is already taken.', 409));
    }

    const pin_hash = await bcrypt.hash(pin, 12);

    const result = await pool.query(
      `UPDATE kids 
       SET username = $1, pin_hash = $2, pin_reset_required = false, pin_failed_attempts = 0, pin_locked_until = NULL 
       WHERE id = $3 AND parent_id = $4 
       RETURNING id, name, username, avatar,
                 (pin_hash IS NOT NULL) AS has_pin`,
      [username.toLowerCase().trim(), pin_hash, kidId, parentId]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Kid not found or access denied.', 404));
    }

    res.status(200).json({
      status: 'success',
      message: 'Login credentials set successfully.',
      data: { kid: result.rows[0] },
    });
  } catch (error) {
    next(error);
  }
};

// ─── UPDATE KID LOGIN (change username or PIN) ────────────────────────────────

export const updateKidLogin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = req.user?.id;
    if (!parentId) return next(new AppError('Unauthorized access.', 401));

    const { kidId } = req.params;
    const { username, pin } = req.body;

    if (!username && !pin) {
      return next(new AppError('Please provide a username or PIN to update.', 400));
    }

    if (pin && !/^\d{4}$/.test(pin)) {
      return next(new AppError('PIN must be exactly 4 digits.', 400));
    }

    const kidCheck = await pool.query(
      'SELECT id FROM kids WHERE id = $1 AND parent_id = $2',
      [kidId, parentId]
    );
    if (kidCheck.rows.length === 0) {
      return next(new AppError('Kid not found or does not belong to you.', 404));
    }

    if (username) {
      const usernameCheck = await pool.query(
        'SELECT id FROM kids WHERE username = $1 AND id != $2',
        [username.toLowerCase(), kidId]
      );
      if (usernameCheck.rows.length > 0) {
        return next(new AppError('That username is already taken. Try another.', 409));
      }
    }

    const pin_hash = pin ? await bcrypt.hash(pin, 12) : null;

    const result = await pool.query(
      `UPDATE kids
       SET
         username = COALESCE($1, username),
         pin_hash = COALESCE($2, pin_hash),
         pin_reset_required = CASE WHEN $2::text IS NOT NULL THEN false ELSE pin_reset_required END
       WHERE id = $3 AND parent_id = $4
       RETURNING id, name, username, avatar,
                 CASE WHEN pin_hash IS NOT NULL THEN true ELSE false END AS has_pin`,
      [username?.toLowerCase() ?? null, pin_hash, kidId, parentId]
    );

    res.status(200).json({
      status: 'success',
      message: 'Login credentials updated.',
      data: { kid: result.rows[0] },
    });
  } catch (error) {
    next(error);
  }
};

// ─── UPDATE KID PROFILE (name, age, grade, avatar) ───────────────────────────

export const updateKid = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = req.user?.id;
    if (!parentId) return next(new AppError('Unauthorized access.', 401));

    const { kidId } = req.params;
    const { name, age, grade, avatar } = req.body;

    const result = await pool.query(
      `UPDATE kids
       SET
         name   = COALESCE($1, name),
         age    = COALESCE($2, age),
         grade  = COALESCE($3, grade),
         avatar = COALESCE($4, avatar)
       WHERE id = $5 AND parent_id = $6
       RETURNING id, parent_id, name, age, grade, avatar, username,
                 CASE WHEN pin_hash IS NOT NULL THEN true ELSE false END AS has_pin,
                 created_at`,
      [name ?? null, age ?? null, grade ?? null, avatar ?? null, kidId, parentId]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Kid not found or does not belong to you.', 404));
    }

    res.status(200).json({
      status: 'success',
      data: { kid: result.rows[0] },
    });
  } catch (error) {
    next(error);
  }
};

// ─── KID LOGIN ────────────────────────────────────────────────────────────────

// ─── GET KID ME ───────────────────────────────────────────────────────────────

export const getKidMe = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kidId = req.user?.id;
    if (!kidId) return next(new AppError('Unauthorized.', 401));

    const result = await pool.query(
      `SELECT id, parent_id, name, age, grade, avatar, username,
              CASE WHEN pin_hash IS NOT NULL THEN true ELSE false END AS has_pin,
              created_at
       FROM kids WHERE id = $1`,
      [kidId]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Kid not found.', 404));
    }

    res.status(200).json({
      status: 'success',
      data: { kid: { ...result.rows[0], role: 'kid' } },
    });
  } catch (error) {
    next(error);
  }
};