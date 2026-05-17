import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { AppError } from '../utils/appError';
import { IUser } from '../interfaces/user.interface';
import { calculateNextPaymentDate } from '../utils/paymentSchedule';
import { IKid } from '../interfaces/kid.interface';

interface AuthRequest extends Request {
  user?: IUser;
}

interface KidAuthRequest extends Request {
  kid?: IKid;
}

export const enrollKid = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const client = await pool.connect();
  try {
    const parentId = req.user?.id;
    if (!parentId) return next(new AppError('Unauthorized access.', 401));

    const { kid_id, course_id, fee_amount, billing_cycle, start_date } = req.body;
    //              ↑ changed from course_name to course_id

    if (!kid_id || !course_id || !fee_amount || !billing_cycle) {
      return next(new AppError('Please provide kid, course, fee, and billing cycle.', 400));
    }

    await client.query('BEGIN');

    // Verify kid belongs to parent
    const kidCheck = await client.query(
      'SELECT id FROM kids WHERE id = $1 AND parent_id = $2',
      [kid_id, parentId]
    );
    if (kidCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return next(new AppError('Kid not found or does not belong to you.', 404));
    }

    // ✅ Look up course to get name and confirm it exists
    const courseCheck = await client.query(
      'SELECT id, title FROM courses WHERE id = $1',
      [course_id]
    );
    if (courseCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return next(new AppError('Course not found.', 404));
    }

    const course_name = courseCheck.rows[0].title;

    // ✅ Prevent duplicate active enrollment
    const dupCheck = await client.query(
      `SELECT id FROM enrollments 
       WHERE kid_id = $1 AND course_id = $2 AND status NOT IN ('cancelled')`,
      [kid_id, course_id]
    );
    if (dupCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return next(new AppError('This kid is already enrolled in that course.', 409));
    }

    // ✅ Save both course_id and course_name
    const result = await client.query(
      `INSERT INTO enrollments 
        (kid_id, parent_id, course_id, course_name, fee_amount, billing_cycle, start_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending') RETURNING *`,
      [kid_id, parentId, course_id, course_name, fee_amount, billing_cycle, start_date || new Date()]
    );

    await client.query('COMMIT');

    res.status(201).json({
      status: 'success',
      message: 'Enrollment created. Please complete payment to activate.',
      data: { enrollment: result.rows[0] }
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

/**
 * GET MY ENROLLED COURSES (KID VIEW)
 * Kids can only view courses they have been enrolled in by their parent
 * Only shows active enrollments (paid and activated)
 */
export const getMyEnrolledCourses = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // ✅ Read from req.user — that's what isAuthenticated sets
    const kidId = req.user?.id;

    if (!kidId || req.user?.role !== 'kid') {
      return next(new AppError('Unauthorized access. Please login as a kid.', 401));
    }

    const result = await pool.query(
      `SELECT 
        e.id as enrollment_id,
        e.course_id,
        e.course_name,
        e.fee_amount,
        e.billing_cycle,
        e.start_date,
        e.status as enrollment_status,
        e.created_at as enrolled_at,
        c.description,
        c.duration,
        c.image_url,
        c.category,
        (
          SELECT COUNT(*)::int 
          FROM kid_progress kp
          WHERE kp.enrollment_id = e.id AND kp.completed = true
        ) as completed_lessons,
        (
          SELECT COUNT(*)::int 
          FROM lessons l
          JOIN modules m ON m.id = l.module_id
          WHERE m.course_id = e.course_id    -- ✅ use course_id not string match
        ) as total_lessons
       FROM enrollments e
       LEFT JOIN courses c ON c.id = e.course_id  -- ✅ join on id not title
       WHERE e.kid_id = $1 
         AND e.status = 'active'
       ORDER BY e.created_at DESC`,
      [kidId]
    );

    const courses = result.rows.map((course) => {
      const total = course.total_lessons || 0;
      const completed = course.completed_lessons || 0;

      return {
        enrollment_id: course.enrollment_id,
        course_id: course.course_id,
        name: course.course_name,
        description: course.description,
        duration: course.duration,
        image: course.image_url,
        category: course.category,
        enrolled_at: course.enrolled_at,
        status: course.enrollment_status,
        progress: total > 0 ? Math.round((completed / total) * 100) : 0,
        completed_lessons: completed,
        total_lessons: total,
      };
    });

    res.status(200).json({
      status: 'success',
      results: courses.length,
      data: { courses }
    });
  } catch (error) {
    next(error);
  }
};
