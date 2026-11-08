import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { AppError } from '../utils/appError';
import { TRIAL_DAYS } from '../utils/trial';

/**
 * Free trial: one per child, TRIAL_DAYS long, no payment needed (see utils/trial.ts for how it works).
 * A trial belongs to an ENROLLMENT: the parent enrolls the child as usual, then starts the trial instead of paying.
 */

/** Days for this course's trial: the course's own number when it is sensible, otherwise the standard 7. */
const daysFor = (courseDays: unknown): number => {
  const n = Number(courseDays);
  return Number.isInteger(n) && n >= 1 && n <= 30 ? n : TRIAL_DAYS;
};

// ─── Start the free trial for an unpaid enrollment ───────────────────────────

export const startFreeTrial = async (req: Request, res: Response, next: NextFunction) => {
  const client = await pool.connect();
  try {
    const parentId = req.user?.id;
    if (!parentId) {
      client.release();
      return next(new AppError('You must be logged in to start a free trial.', 401));
    }
    const { enrollment_id } = req.body as { enrollment_id: string };

    await client.query('BEGIN');

    // Lock the enrollment so two taps at once cannot start two trials.
    const found = await client.query(
      `SELECT e.id, e.kid_id, e.course_id, e.status, c.is_trial_available, c.trial_duration_days
         FROM enrollments e
         LEFT JOIN courses c ON c.id = e.course_id
        WHERE e.id = $1 AND e.parent_id = $2
        FOR UPDATE OF e`,
      [enrollment_id, parentId]
    );
    if (found.rows.length === 0) {
      await client.query('ROLLBACK');
      return next(new AppError('Enrollment not found or does not belong to you.', 404));
    }
    const e = found.rows[0];

    if (e.status === 'active') {
      await client.query('ROLLBACK');
      return next(new AppError('This course is already active.', 409));
    }
    if (e.status !== 'pending' || !e.course_id) {
      await client.query('ROLLBACK');
      return next(new AppError('A free trial cannot be started for this enrollment.', 400));
    }
    if (e.is_trial_available === false) {
      await client.query('ROLLBACK');
      return next(new AppError('A free trial is not available for this course.', 400));
    }

    // One free trial per child, ever.
    const used = await client.query('SELECT 1 FROM trial_access WHERE kid_id = $1 LIMIT 1', [e.kid_id]);
    if (used.rows.length > 0) {
      await client.query('ROLLBACK');
      return next(new AppError('This child has already used their free trial. You can pay to continue.', 400));
    }

    const days = daysFor(e.trial_duration_days);
    const upd = await client.query(
      `UPDATE enrollments
          SET status = 'active', payment_status = 'pending',
              trial_ends_at = now() + ($2 || ' days')::interval
        WHERE id = $1 AND status = 'pending'
      RETURNING trial_ends_at`,
      [e.id, String(days)]
    );
    const endsAt: Date = upd.rows[0].trial_ends_at;
    await client.query(`INSERT INTO trial_access (kid_id, course_id, expires_at, status) VALUES ($1, $2, $3, 'active')`, [e.kid_id, e.course_id, endsAt]);

    await client.query('COMMIT');
    res.status(201).json({
      status: 'success',
      message: `Free trial started. ${days} days of learning, no payment needed.`,
      data: { trial: { enrollment_id: e.id, expires_at: endsAt, duration_days: days } },
    });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    // the unique index on trial_access.kid_id: another request used the trial a moment earlier
    if (error?.code === '23505') return next(new AppError('This child has already used their free trial. You can pay to continue.', 400));
    next(error);
  } finally {
    client.release();
  }
};

// ─── Which of my children can still start a free trial? ──────────────────────

export const getTrialEligibility = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = req.user?.id;
    if (!parentId) return next(new AppError('You must be logged in.', 401));
    const { rows } = await pool.query(
      `SELECT k.id AS kid_id,
              EXISTS (SELECT 1 FROM trial_access t WHERE t.kid_id = k.id) AS used
         FROM kids k WHERE k.parent_id = $1`,
      [parentId]
    );
    res.status(200).json({
      status: 'success',
      data: { trial_days: TRIAL_DAYS, kids: rows.map((r) => ({ kid_id: r.kid_id, used: r.used === true })) },
    });
  } catch (error) {
    next(error);
  }
};

// ─── Look at trials (parent) ─────────────────────────────────────────────────

export const checkTrialStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { kid_id, course_id } = req.params;
    if (!req.user?.id) return next(new AppError('You must be logged in to check trial status', 401));

    const kidCheck = await pool.query('SELECT id FROM kids WHERE id = $1 AND parent_id = $2', [kid_id, req.user.id]);
    if (kidCheck.rows.length === 0) return next(new AppError('Kid not found or does not belong to you', 404));

    const result = await pool.query(
      `SELECT t.*, CEIL(EXTRACT(EPOCH FROM (t.expires_at - NOW())) / 86400)::int AS days_remaining
         FROM trial_access t
        WHERE t.kid_id = $1 AND t.course_id = $2 AND t.status = 'active' AND t.expires_at > NOW()`,
      [kid_id, course_id]
    );
    if (result.rows.length === 0) return res.status(200).json({ status: 'success', data: { hasActiveTrial: false } });

    const t = result.rows[0];
    res.status(200).json({
      status: 'success',
      data: {
        hasActiveTrial: true,
        trial: {
          id: t.id, kid_id: t.kid_id, course_id: t.course_id, started_at: t.started_at, expires_at: t.expires_at,
          days_remaining: Number(t.days_remaining) || 0,
          is_expiring_soon: Number(t.days_remaining) <= 2,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getActiveTrials = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.id) return next(new AppError('You must be logged in to view trials', 401));
    const result = await pool.query(
      `SELECT t.*, k.name AS kid_name, c.title AS course_title,
              CEIL(EXTRACT(EPOCH FROM (t.expires_at - NOW())) / 86400)::int AS days_remaining
         FROM trial_access t
         JOIN kids k ON k.id = t.kid_id
         JOIN courses c ON c.id = t.course_id
        WHERE k.parent_id = $1 AND t.status = 'active' AND t.expires_at > NOW()
        ORDER BY t.expires_at ASC`,
      [req.user.id]
    );
    const trials = result.rows.map((t) => ({ ...t, days_remaining: Number(t.days_remaining) || 0, is_expiring_soon: Number(t.days_remaining) <= 2 }));
    res.status(200).json({ status: 'success', results: trials.length, data: { trials } });
  } catch (error) {
    next(error);
  }
};
