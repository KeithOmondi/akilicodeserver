import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { AppError } from '../utils/appError';

export const createCourse = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, description, price, duration, category, image_url } = req.body;

    if (!title || !price) {
      return next(new AppError('Please provide title, price, and duration.', 400));
    }

    const result = await pool.query(
      `INSERT INTO courses (title, description, price, duration, category, image_url)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, description ?? null, price, duration ?? null, category ?? null, image_url ?? null]
    );

    res.status(201).json({ status: 'success', data: { course: result.rows[0] } });
  } catch (error) {
    next(error);
  }
};

export const getAllCourses = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query('SELECT * FROM courses ORDER BY created_at DESC');

    res.status(200).json({
      status: 'success',
      results: result.rows.length,
      data: { courses: result.rows },
    });
  } catch (error) {
    next(error);
  }
};