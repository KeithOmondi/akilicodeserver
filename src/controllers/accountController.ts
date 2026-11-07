import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import env from '../config/env';
import { AppError } from '../utils/appError';
import { deleteParentAccount, exportParentData } from '../services/dataLifecycle';

/** GET /auth/me/export — everything we hold about this parent and their children (parent gate). */
export const exportMe = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await exportParentData(req.user!.id);
    res.setHeader('Content-Disposition', 'attachment; filename="akili-my-data.json"');
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

/** PATCH /auth/me  { name } — change the display name. */
export const updateMe = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(
      'UPDATE users SET name = $2 WHERE id = $1 RETURNING id, name, email, phone, role, is_verified',
      [req.user!.id, req.body.name]
    );
    if (rows.length === 0) return next(new AppError('Account not found.', 404));
    res.status(200).json({ status: 'success', message: 'Your name has been updated.', data: { user: rows[0] } });
  } catch (error) {
    next(error);
  }
};

/** DELETE /auth/me  { confirm: "DELETE" } — erase the account and every child (parent gate). */
export const deleteMe = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteParentAccount(req.user!.id);
    res.clearCookie('refreshToken', { httpOnly: true, sameSite: 'lax', secure: env.IS_PRODUCTION });
    res.status(200).json({ status: 'success', message: 'Your account and all of your children’s data have been deleted.' });
  } catch (error) {
    next(error);
  }
};

// ── Admin ────────────────────────────────────────────────────────────────────

export const getAllUsers = async (_req: Request, res: Response, next: NextFunction) => {
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

/** An admin can delete a parent (support request / legal erasure). Admin accounts cannot be deleted here. */
export const adminDeleteUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteParentAccount(req.params.userId as string);
    res.status(200).json({ status: 'success', message: 'User deleted.' });
  } catch (error) {
    next(error);
  }
};

/** Change a role. You cannot change your own, so the last admin cannot lock everyone out. */
export const updateUserRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.params.userId === req.user!.id) {
      return next(new AppError('You cannot change your own role.', 400));
    }
    const result = await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, name, email, phone, role',
      [req.body.role, req.params.userId]
    );
    if (result.rows.length === 0) return next(new AppError('User not found.', 404));
    res.status(200).json({ status: 'success', data: { user: result.rows[0] } });
  } catch (error) {
    next(error);
  }
};
