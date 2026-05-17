// controllers/kidLearningController.ts
import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { AppError } from '../utils/appError';
import { IUser } from '../interfaces/user.interface';
import { IKid } from '../interfaces/kid.interface';

// ✅ Use req.user which is what isAuthenticated actually sets
interface KidRequest extends Omit<Request, 'user'> {
  user?: IUser | IKid;
}

/**
 * GET ALL ENROLLED COURSES FOR THE KID
 */
export const getMyCourses = async (req: KidRequest, res: Response, next: NextFunction) => {
  try {
    const kidId = req.user?.id; // ✅ was req.kid?.id
    if (!kidId) return next(new AppError('Unauthorized access.', 401));

    const result = await pool.query(
      `SELECT 
        e.id as enrollment_id,
        e.course_name,
        e.course_id,
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
          WHERE m.course_id = e.course_id
        ) as total_lessons
       FROM enrollments e
       LEFT JOIN courses c ON c.id = e.course_id
       WHERE e.kid_id = $1 
         AND e.status = 'active'
       ORDER BY e.created_at DESC`,
      [kidId]
    );

    const courses = result.rows.map((row) => ({
      enrollment_id: row.enrollment_id,
      course_id: row.course_id,
      name: row.course_name,
      description: row.description,
      duration: row.duration,
      image: row.image_url,
      category: row.category,
      enrolled_at: row.enrolled_at,
      status: row.enrollment_status,
      progress: row.total_lessons > 0
        ? Math.round((row.completed_lessons / row.total_lessons) * 100)
        : 0,
      completed_lessons: row.completed_lessons,
      total_lessons: row.total_lessons,
    }));

    res.status(200).json({
      status: 'success',
      results: courses.length,
      data: { courses }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET COURSE CONTENT — MODULES AND LESSONS
 */
export const getCourseContent = async (req: KidRequest, res: Response, next: NextFunction) => {
  try {
    const kidId = req.user?.id; // ✅
    const { enrollmentId } = req.params;

    if (!kidId) return next(new AppError('Unauthorized access.', 401));

    const enrollmentResult = await pool.query(
      `SELECT id, course_id, course_name
       FROM enrollments
       WHERE id = $1 AND kid_id = $2 AND status = 'active'`,
      [enrollmentId, kidId]
    );

    if (enrollmentResult.rows.length === 0) {
      return next(new AppError('Enrollment not found or access denied.', 403));
    }

    const enrollment = enrollmentResult.rows[0];

    const modulesResult = await pool.query(
  `SELECT 
    m.id,
    m.title,
    m.description,
    m.order_index,
    COALESCE(
      json_agg(
        json_build_object(
          'id',           l.id,
          'title',        l.title,
          'notes',        l.notes,
          'language',     l.language,
          'starter_code', l.starter_code,
          'order_index',  l.order_index,
          'completed',    COALESCE(kp.completed, false),
          'points_earned',COALESCE(kp.points_earned, 0)
        ) ORDER BY l.order_index
      ) FILTER (WHERE l.id IS NOT NULL),
      '[]'
    ) as lessons
   FROM modules m
   LEFT JOIN lessons l ON l.module_id = m.id
   LEFT JOIN kid_progress kp 
     ON kp.lesson_id = l.id 
     AND kp.enrollment_id = $1
   WHERE m.course_id = $2
   GROUP BY m.id
   ORDER BY m.order_index ASC`,
  [enrollmentId, enrollment.course_id]
);

    res.status(200).json({
      status: 'success',
      data: {
        enrollment_id: enrollment.id,
        course_name: enrollment.course_name,
        modules: modulesResult.rows
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET A SINGLE LESSON
 */
export const getLesson = async (req: KidRequest, res: Response, next: NextFunction) => {
  try {
    const kidId = req.user?.id; // ✅
    const { enrollmentId, lessonId } = req.params;

    if (!kidId) return next(new AppError('Unauthorized access.', 401));

    const enrollmentResult = await pool.query(
      `SELECT id, course_id FROM enrollments
       WHERE id = $1 AND kid_id = $2 AND status = 'active'`,
      [enrollmentId, kidId]
    );

    if (enrollmentResult.rows.length === 0) {
      return next(new AppError('Enrollment not found or access denied.', 403));
    }

    const { course_id } = enrollmentResult.rows[0];

    const lessonResult = await pool.query(
      `SELECT l.*
       FROM lessons l
       JOIN modules m ON m.id = l.module_id
       WHERE l.id = $1 AND m.course_id = $2`,
      [lessonId, course_id]
    );

    if (lessonResult.rows.length === 0) {
      return next(new AppError('Lesson not found or does not belong to your course.', 404));
    }

    const progressResult = await pool.query(
      `SELECT * FROM kid_progress
       WHERE kid_id = $1 AND lesson_id = $2 AND enrollment_id = $3
       LIMIT 1`,
      [kidId, lessonId, enrollmentId]
    );

    res.status(200).json({
      status: 'success',
      data: {
        lesson: {
          ...lessonResult.rows[0],
          completed: progressResult.rows[0]?.completed || false,
          points_earned: progressResult.rows[0]?.points_earned || 0,
          code_submitted: progressResult.rows[0]?.code_submitted || null,
          completed_at: progressResult.rows[0]?.completed_at || null
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * SUBMIT LESSON SOLUTION AND EARN POINTS
 */
export const submitLesson = async (req: KidRequest, res: Response, next: NextFunction) => {
  const client = await pool.connect();
  try {
    const kidId = req.user?.id; // ✅
    const { enrollmentId, lessonId } = req.params;
    const { code_submitted } = req.body;

    if (!kidId) return next(new AppError('Unauthorized access.', 401));

    await client.query('BEGIN');

    const enrollmentResult = await client.query(
      `SELECT id, course_id FROM enrollments
       WHERE id = $1 AND kid_id = $2 AND status = 'active'`,
      [enrollmentId, kidId]
    );

    if (enrollmentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return next(new AppError('Enrollment not found or access denied.', 403));
    }

    const { course_id } = enrollmentResult.rows[0];

    const lessonResult = await client.query(
      `SELECT l.id FROM lessons l
       JOIN modules m ON m.id = l.module_id
       WHERE l.id = $1 AND m.course_id = $2`,
      [lessonId, course_id]
    );

    if (lessonResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return next(new AppError('Lesson not found or does not belong to your course.', 404));
    }

    const existingProgress = await client.query(
      `SELECT * FROM kid_progress
       WHERE kid_id = $1 AND lesson_id = $2 AND enrollment_id = $3`,
      [kidId, lessonId, enrollmentId]
    );

    if (existingProgress.rows[0]?.completed) {
      await client.query('ROLLBACK');
      return next(new AppError('Lesson already completed.', 400));
    }

    const totalPoints = 10;

    const progressResult = await client.query(
      `INSERT INTO kid_progress
        (kid_id, lesson_id, enrollment_id, completed, points_earned, code_submitted, completed_at)
       VALUES ($1, $2, $3, true, $4, $5, NOW())
       ON CONFLICT (kid_id, lesson_id, enrollment_id)
       DO UPDATE SET
         completed = true,
         points_earned = EXCLUDED.points_earned,
         code_submitted = EXCLUDED.code_submitted,
         completed_at = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [kidId, lessonId, enrollmentId, totalPoints, code_submitted || null]
    );

    await client.query(
      `UPDATE kids
       SET total_points = COALESCE(total_points, 0) + $1
       WHERE id = $2`,
      [totalPoints, kidId]
    );

    await client.query('COMMIT');

    res.status(200).json({
      status: 'success',
      data: {
        progress: progressResult.rows[0],
        points_earned: totalPoints,
        message: `Great job! You earned ${totalPoints} points! 🎉`
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

/**
 * GET KID'S DASHBOARD STATS
 */
export const getDashboardStats = async (req: KidRequest, res: Response, next: NextFunction) => {
  try {
    const kidId = req.user?.id; // ✅
    if (!kidId) return next(new AppError('Unauthorized access.', 401));

    const kidResult = await pool.query(
      `SELECT name, age, grade, avatar, total_points, COALESCE(streak_days, 0) as streak_days
       FROM kids WHERE id = $1`,
      [kidId]
    );

    const courseStats = await pool.query(
      `SELECT
        COUNT(DISTINCT e.id) as total_courses,
        SUM(CASE WHEN kp.completed = true THEN 1 ELSE 0 END) as completed_lessons,
        (
          SELECT COUNT(*)::int
          FROM lessons l
          JOIN modules m ON m.id = l.module_id
          JOIN enrollments e2 ON e2.course_id = m.course_id
          WHERE e2.kid_id = $1 AND e2.status = 'active'
        ) as total_lessons
       FROM enrollments e
       LEFT JOIN kid_progress kp ON kp.enrollment_id = e.id AND kp.completed = true
       WHERE e.kid_id = $1 AND e.status = 'active'`,
      [kidId]
    );

    const recentAchievements = await pool.query(
      `SELECT
        l.title as name,
        kp.completed_at as earned_at,
        kp.points_earned
       FROM kid_progress kp
       JOIN lessons l ON l.id = kp.lesson_id
       WHERE kp.kid_id = $1 AND kp.completed = true
       ORDER BY kp.completed_at DESC
       LIMIT 5`,
      [kidId]
    );

    const totalPoints = kidResult.rows[0]?.total_points || 0;
    const level = Math.floor(totalPoints / 100) + 1;
    const pointsToNextLevel = (level * 100) - totalPoints;

    res.status(200).json({
      status: 'success',
      data: {
        kid: kidResult.rows[0],
        stats: {
          total_courses: parseInt(courseStats.rows[0]?.total_courses) || 0,
          completed_lessons: parseInt(courseStats.rows[0]?.completed_lessons) || 0,
          total_lessons: parseInt(courseStats.rows[0]?.total_lessons) || 0,
          total_points: totalPoints,
          level,
          points_to_next_level: pointsToNextLevel,
          streak_days: kidResult.rows[0]?.streak_days || 0
        },
        recent_achievements: recentAchievements.rows
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET LEADERBOARD
 */
export const getLeaderboard = async (req: KidRequest, res: Response, next: NextFunction) => {
  try {
    const { limit = 10 } = req.query;

    const result = await pool.query(
      `SELECT
        k.id,
        k.name,
        k.avatar,
        k.total_points,
        COALESCE(k.streak_days, 0) as streak_days,
        COUNT(DISTINCT kp.lesson_id) as lessons_completed
       FROM kids k
       LEFT JOIN kid_progress kp ON kp.kid_id = k.id AND kp.completed = true
       WHERE k.total_points > 0
       GROUP BY k.id
       ORDER BY k.total_points DESC
       LIMIT $1`,
      [limit]
    );

    const leaderboard = result.rows.map((kid, index) => ({
      rank: index + 1,
      ...kid
    }));

    res.status(200).json({
      status: 'success',
      data: { leaderboard }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET KID'S ACHIEVEMENTS / BADGES
 */
export const getAchievements = async (req: KidRequest, res: Response, next: NextFunction) => {
  try {
    const kidId = req.user?.id; // ✅
    if (!kidId) return next(new AppError('Unauthorized access.', 401));

    const result = await pool.query(
      `SELECT
        COUNT(DISTINCT lesson_id) as total_lessons_completed,
        SUM(points_earned) as total_points_earned,
        COUNT(DISTINCT CASE
          WHEN completed_at > NOW() - INTERVAL '7 days' THEN lesson_id
        END) as lessons_this_week
       FROM kid_progress
       WHERE kid_id = $1 AND completed = true`,
      [kidId]
    );

    const completed = parseInt(result.rows[0]?.total_lessons_completed) || 0;
    const badges = [];

    if (completed >= 1)  badges.push({ name: 'First Step',      icon: '🌟', earned: true });
    if (completed >= 5)  badges.push({ name: 'Rising Star',      icon: '⭐', earned: true });
    if (completed >= 10) badges.push({ name: 'Code Master',      icon: '🏆', earned: true });
    if (completed >= 25) badges.push({ name: 'Legendary Coder',  icon: '🎖️', earned: true });
    if (completed >= 50) badges.push({ name: 'Coding Hero',      icon: '🦸', earned: true });

    if (completed < 5)  badges.push({ name: 'Rising Star',     icon: '⭐', earned: false, needed: 5  - completed });
    if (completed < 10) badges.push({ name: 'Code Master',     icon: '🏆', earned: false, needed: 10 - completed });
    if (completed < 25) badges.push({ name: 'Legendary Coder', icon: '🎖️', earned: false, needed: 25 - completed });

    res.status(200).json({
      status: 'success',
      data: { stats: result.rows[0], badges }
    });
  } catch (error) {
    next(error);
  }
};