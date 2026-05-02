import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { AppError } from '../utils/appError';
import { IUser } from '../interfaces/user.interface';
import { calculateNextPaymentDate } from '../utils/paymentSchedule';

interface AuthRequest extends Request {
  user?: IUser;
}

/**
 * ENROLL A KID
 */
export const enrollKid = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const client = await pool.connect();
  try {
    const parentId = req.user?.id;
    if (!parentId) return next(new AppError('Unauthorized access.', 401));

    const { kid_id, course_name, fee_amount, billing_cycle, start_date } = req.body;

    if (!kid_id || !course_name || !fee_amount || !billing_cycle) {
      return next(new AppError('Please provide kid, course, fee, and billing cycle.', 400));
    }

    await client.query('BEGIN');

    const kidCheck = await client.query(
      'SELECT id FROM kids WHERE id = $1 AND parent_id = $2',
      [kid_id, parentId]
    );

    if (kidCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return next(new AppError('Kid not found or does not belong to you.', 404));
    }

    const result = await client.query(
      `INSERT INTO enrollments (kid_id, parent_id, course_name, fee_amount, billing_cycle, start_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING *`,
      [kid_id, parentId, course_name, fee_amount, billing_cycle, start_date || new Date()]
    );

    const enrollment = result.rows[0];

    await client.query('COMMIT');

    res.status(201).json({
      status: 'success',
      message: 'Enrollment created. Please complete payment to activate.',
      data: { enrollment }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

/**
 * GET ALL ENROLLMENTS FOR MY KIDS
 * Includes next_payment_date calculated from last completed payment
 */
export const getMyEnrollments = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parentId = req.user?.id;
    if (!parentId) return next(new AppError('Unauthorized access.', 401));

    const result = await pool.query(
      `SELECT 
        e.*,
        k.name AS kid_name,
        -- Get the most recent completed payment date for this enrollment
        (
          SELECT MAX(p.date) 
          FROM payments p 
          WHERE p.enrollment_id = e.id AND p.status = 'completed'
        ) AS last_payment_date,
        -- Count total completed payments
        (
          SELECT COUNT(*) 
          FROM payments p 
          WHERE p.enrollment_id = e.id AND p.status = 'completed'
        ) AS total_payments
       FROM enrollments e
       JOIN kids k ON e.kid_id = k.id
       WHERE e.parent_id = $1
       ORDER BY e.created_at DESC`,
      [parentId]
    );

    // Calculate next_payment_date for each enrollment
    const enrollments = result.rows.map((enrollment) => {
      const lastPaymentDate = enrollment.last_payment_date
        ? new Date(enrollment.last_payment_date)
        : null;

      let next_payment_date: Date | null = null;
      let payment_status: string = 'pending';

      if (enrollment.status === 'pending') {
        payment_status = 'unpaid';
      } else if (enrollment.status === 'cancelled') {
        payment_status = 'cancelled';
      } else if (enrollment.billing_cycle === 'once-off') {
        // Once-off — completed after first payment
        payment_status = 'once-off';
        next_payment_date = null;
      } else if (lastPaymentDate) {
        next_payment_date = calculateNextPaymentDate(
          lastPaymentDate,
          enrollment.billing_cycle
        );

        // Determine payment status
        if (!next_payment_date) {
          payment_status = 'once-off';
        } else {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const due = new Date(next_payment_date);
          due.setHours(0, 0, 0, 0);
          const daysUntilDue = Math.ceil(
            (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
          );

          if (daysUntilDue < 0) payment_status = 'overdue';
          else if (daysUntilDue <= 7) payment_status = 'due_soon';
          else payment_status = 'paid';
        }
      }

      return {
        ...enrollment,
        next_payment_date: next_payment_date?.toISOString().split('T')[0] ?? null,
        payment_status,
      };
    });

    res.status(200).json({
      status: 'success',
      results: enrollments.length,
      data: { enrollments }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET ENROLLMENTS FOR A SPECIFIC KID
 */
export const getKidEnrollments = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parentId = req.user?.id;
    if (!parentId) return next(new AppError('Unauthorized access.', 401));

    const { kidId } = req.params;

    const result = await pool.query(
      `SELECT e.*, k.name AS kid_name
       FROM enrollments e
       JOIN kids k ON e.kid_id = k.id
       WHERE e.kid_id = $1 AND e.parent_id = $2
       ORDER BY e.created_at DESC`,
      [kidId, parentId]
    );

    res.status(200).json({
      status: 'success',
      results: result.rows.length,
      data: { enrollments: result.rows }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * CANCEL AN ENROLLMENT
 */
export const cancelEnrollment = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parentId = req.user?.id;
    if (!parentId) return next(new AppError('Unauthorized access.', 401));

    const { enrollmentId } = req.params;

    const result = await pool.query(
      `UPDATE enrollments SET status = 'cancelled'
       WHERE id = $1 AND parent_id = $2 RETURNING *`,
      [enrollmentId, parentId]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Enrollment not found or does not belong to you.', 404));
    }

    res.status(200).json({
      status: 'success',
      data: { enrollment: result.rows[0] }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET ALL ENROLLMENTS (ADMIN ONLY)
 */
export const getAllEnrollments = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      `SELECT 
        e.*, 
        k.name AS kid_name, 
        u.name AS parent_name, 
        u.email AS parent_email,
        (
          SELECT MAX(p.date) 
          FROM payments p 
          WHERE p.enrollment_id = e.id AND p.status = 'completed'
        ) AS last_payment_date
       FROM enrollments e
       JOIN kids k ON e.kid_id = k.id
       JOIN users u ON e.parent_id = u.id
       ORDER BY e.created_at DESC`
    );

    res.status(200).json({
      status: 'success',
      results: result.rows.length,
      data: { enrollments: result.rows }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET A SINGLE ENROLLMENT BY ID (PARENT)
 */
export const getEnrollmentById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parentId = req.user?.id;
    if (!parentId) return next(new AppError('Unauthorized access.', 401));

    const { enrollmentId } = req.params;

    const result = await pool.query(
      `SELECT e.*, k.name AS kid_name
       FROM enrollments e
       JOIN kids k ON e.kid_id = k.id
       WHERE e.id = $1 AND e.parent_id = $2`,
      [enrollmentId, parentId]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Enrollment not found or does not belong to you.', 404));
    }

    res.status(200).json({
      status: 'success',
      data: { enrollment: result.rows[0] }
    });
  } catch (error) {
    next(error);
  }
};

