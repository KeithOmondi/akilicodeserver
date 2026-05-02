import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { AppError } from '../utils/appError';
import { IUser } from '../interfaces/user.interface';

interface AuthRequest extends Request {
  user?: IUser;
}

const generateReceiptNumber = () => `RCP-${Date.now()}`;

/**
 * GET ALL PAYMENTS (ADMIN ONLY)
 */
export const getAllPayments = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      `SELECT 
        p.*, 
        k.name AS kid_name, 
        e.course_name, 
        u.name AS parent_name,
        u.email AS parent_email
       FROM payments p
       JOIN kids k ON p.kid_id = k.id
       JOIN enrollments e ON p.enrollment_id = e.id
       JOIN users u ON p.parent_id = u.id
       ORDER BY p.created_at DESC`
    );

    res.status(200).json({
      status: 'success',
      results: result.rows.length,
      data: { payments: result.rows }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * CREATE A PAYMENT
 * - Accepts pending or active enrollments
 * - Activates the enrollment after successful payment
 */
export const createPayment = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const client = await pool.connect();
  try {
    const parentId = req.user?.id;
    if (!parentId) return next(new AppError('Unauthorized access.', 401));

    const { enrollment_id, amount, method, reference, description, date } = req.body;

    if (!enrollment_id || !amount || !method) {
      return next(new AppError('Please provide enrollment, amount, and payment method.', 400));
    }

    await client.query('BEGIN');

    // Confirm enrollment belongs to this parent and is pending or active
    const enrollmentCheck = await client.query(
      `SELECT e.*, k.id AS kid_id FROM enrollments e
       JOIN kids k ON e.kid_id = k.id
       WHERE e.id = $1 AND e.parent_id = $2 AND e.status IN ('pending', 'active')`,
      [enrollment_id, parentId]
    );

    if (enrollmentCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return next(new AppError('Enrollment not found or does not belong to you.', 404));
    }

    const enrollment = enrollmentCheck.rows[0];
    const receipt_number = generateReceiptNumber();

    // Insert the payment
    const result = await client.query(
      `INSERT INTO payments
        (enrollment_id, kid_id, parent_id, amount, method, reference, description, receipt_number, status, date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', $9) RETURNING *`,
      [
        enrollment_id,
        enrollment.kid_id,
        parentId,
        amount,
        method,
        reference || null,
        description || null,
        receipt_number,
        date || new Date()
      ]
    );

    // Activate the enrollment after successful payment
    await client.query(
      `UPDATE enrollments SET status = 'active' WHERE id = $1`,
      [enrollment_id]
    );

    await client.query('COMMIT');

    res.status(201).json({
      status: 'success',
      data: { payment: result.rows[0] }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

/**
 * GET ALL MY PAYMENTS
 */
export const getMyPayments = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parentId = req.user?.id;
    if (!parentId) return next(new AppError('Unauthorized access.', 401));

    const result = await pool.query(
      `SELECT p.*, k.name AS kid_name, e.course_name
       FROM payments p
       JOIN kids k ON p.kid_id = k.id
       JOIN enrollments e ON p.enrollment_id = e.id
       WHERE p.parent_id = $1
       ORDER BY p.created_at DESC`,
      [parentId]
    );

    res.status(200).json({
      status: 'success',
      results: result.rows.length,
      data: { payments: result.rows }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET PAYMENTS FOR A SPECIFIC KID
 */
export const getKidPayments = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parentId = req.user?.id;
    if (!parentId) return next(new AppError('Unauthorized access.', 401));

    const { kidId } = req.params;

    const result = await pool.query(
      `SELECT p.*, k.name AS kid_name, e.course_name
       FROM payments p
       JOIN kids k ON p.kid_id = k.id
       JOIN enrollments e ON p.enrollment_id = e.id
       WHERE p.kid_id = $1 AND p.parent_id = $2
       ORDER BY p.created_at DESC`,
      [kidId, parentId]
    );

    res.status(200).json({
      status: 'success',
      results: result.rows.length,
      data: { payments: result.rows }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET RECEIPT FOR A PAYMENT
 */
export const getReceipt = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parentId = req.user?.id;
    if (!parentId) return next(new AppError('Unauthorized access.', 401));

    const { paymentId } = req.params;

    const result = await pool.query(
      `SELECT p.*, k.name AS kid_name, e.course_name, u.name AS parent_name
       FROM payments p
       JOIN kids k ON p.kid_id = k.id
       JOIN enrollments e ON p.enrollment_id = e.id
       JOIN users u ON p.parent_id = u.id
       WHERE p.id = $1 AND p.parent_id = $2`,
      [paymentId, parentId]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Payment not found.', 404));
    }

    const payment = result.rows[0];

    res.status(200).json({
      status: 'success',
      data: {
        receipt: {
          receipt_number: payment.receipt_number,
          date: payment.date,
          parent_name: payment.parent_name,
          kid_name: payment.kid_name,
          course_name: payment.course_name,
          amount: payment.amount,
          method: payment.method,
          reference: payment.reference,
          description: payment.description,
          status: payment.status
        }
      }
    });
  } catch (error) {
    next(error);
  }
};