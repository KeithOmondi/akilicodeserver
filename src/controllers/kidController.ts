import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { AppError } from '../utils/appError';
import { IUser } from '../interfaces/user.interface';

// Extend the Request type to include the user property
interface AuthRequest extends Request {
  user?: IUser;
}

/**
 * REGISTER A KID
 */
export const registerKid = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, age, grade } = req.body;
    
    // Now TypeScript knows req.user exists
    const parentId = req.user?.id;

    if (!parentId) {
      return next(new AppError('You must be logged in to register a child.', 401));
    }

    if (!name || !age) {
      return next(new AppError('Please provide the child\'s name and age.', 400));
    }

    const result = await pool.query(
      'INSERT INTO kids (parent_id, name, age, grade) VALUES ($1, $2, $3, $4) RETURNING *',
      [parentId, name, age, grade || null]
    );

    res.status(201).json({
      status: 'success',
      data: {
        kid: result.rows[0]
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET MY KIDS
 */
export const getMyKids = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parentId = req.user?.id;

    if (!parentId) {
      return next(new AppError('Unauthorized access.', 401));
    }

    const result = await pool.query(
      'SELECT * FROM kids WHERE parent_id = $1 ORDER BY created_at DESC',
      [parentId]
    );

    res.status(200).json({
      status: 'success',
      results: result.rows.length,
      data: {
        kids: result.rows
      }
    });
  } catch (error) {
    next(error);
  }
};