// src/controllers/kidCalendarController.ts
import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { AppError } from '../utils/appError';
import { IUser } from '../interfaces/user.interface';
import { IKid } from '../interfaces/kid.interface';

interface KidRequest extends Omit<Request, 'user'> {
  user?: IUser | IKid;
}

/**
 * GET /api/v1/kid/calendar
 * Returns all relevant events (lesson completions, submissions, reviews)
 * for the authenticated kid, optionally filtered by year/month.
 * Query params: ?year=2026&month=5 (both optional)
 */
export const getCalendarEvents = async (req: KidRequest, res: Response, next: NextFunction) => {
  try {
    const kidId = req.user?.id;
    if (!kidId) return next(new AppError('Unauthorized access.', 401));

    const { year, month } = req.query;
    let completionsDateFilter = '';
    let submissionsDateFilter = '';
    let reviewsDateFilter = '';
    const params: any[] = [kidId];
    let paramIndex = 2;

    if (year && month) {
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate = new Date(Number(year), Number(month), 0).toISOString().slice(0, 10);

      completionsDateFilter = ` AND DATE(kp.completed_at) BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
      submissionsDateFilter = ` AND DATE(s.submitted_at) BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
      reviewsDateFilter    = ` AND DATE(s.reviewed_at)  BETWEEN $${paramIndex} AND $${paramIndex + 1}`;

      params.push(startDate, endDate);
      paramIndex += 2;
    }

    // 1. Lesson completions from kid_progress
    const completionsQuery = `
      SELECT
        kp.id::text            AS event_id,
        DATE(kp.completed_at)  AS event_date,
        'lesson_completed'     AS event_type,
        l.title                AS lesson_title,
        kp.points_earned::integer,
        NULL::integer          AS marks,
        NULL::text             AS submission_status
      FROM kid_progress kp
      JOIN lessons l ON l.id = kp.lesson_id
      WHERE kp.kid_id = $1
        AND kp.completed = true
        ${completionsDateFilter}
    `;

    // 2. Assignment submissions (from submissions table)
    const submissionsQuery = `
      SELECT
        s.id::text              AS event_id,
        DATE(s.submitted_at)    AS event_date,
        'submission_submitted'  AS event_type,
        l.title                 AS lesson_title,
        NULL::integer           AS points_earned,
        NULL::integer           AS marks,
        s.status::text          AS submission_status
      FROM submissions s
      JOIN lessons l ON l.id = s.lesson_id
      WHERE s.kid_id = $1
        ${submissionsDateFilter}
    `;

    // 3. Assignment reviews (when marks are given)
    const reviewsQuery = `
      SELECT
        s.id::text              AS event_id,
        DATE(s.reviewed_at)     AS event_date,
        'submission_reviewed'   AS event_type,
        l.title                 AS lesson_title,
        NULL::integer           AS points_earned,
        s.marks::integer,
        s.status::text          AS submission_status
      FROM submissions s
      JOIN lessons l ON l.id = s.lesson_id
      WHERE s.kid_id = $1
        AND s.reviewed_at IS NOT NULL
        ${reviewsDateFilter}
    `;

    // Combine all three queries with UNION ALL
    const combinedQuery = `
      ${completionsQuery}
      UNION ALL
      ${submissionsQuery}
      UNION ALL
      ${reviewsQuery}
      ORDER BY event_date DESC
    `;

    const result = await pool.query(combinedQuery, params);

    const events = result.rows.map((row) => ({
      id:           row.event_id,
      date:         row.event_date,
      type:         row.event_type,
      title:        row.lesson_title,
      points_earned: row.points_earned,
      marks:        row.marks,
      status:       row.submission_status,
    }));

    res.status(200).json({
      status: 'success',
      data: { events },
    });
  } catch (error) {
    next(error);
  }
};