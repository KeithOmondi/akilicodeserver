import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { AppError } from '../utils/appError';
import { lessonVisibleSql } from '../utils/ageGroups';
import { trialStillValid } from '../utils/trial';
import { CONSENT_VERSION } from '../services/consent';
import { getScreenTimeStatus, getWeeklyUsage } from '../services/screenTime';

const POINTS_PER_LEVEL = 100;

/** Same milestones the child sees on their own Badges page, so both screens agree. */
const MILESTONES = [
  { name: 'First Step', icon: '🌟', at: 1 },
  { name: 'Rising Star', icon: '⭐', at: 5 },
  { name: 'Code Master', icon: '🏆', at: 10 },
  { name: 'Legendary Coder', icon: '🎖️', at: 25 },
  { name: 'Coding Hero', icon: '🦸', at: 50 },
];

/** Quiz results live in a table older than our schema files; if it is missing, the page simply shows no quizzes. */
const optional = async <T>(run: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await run();
  } catch {
    return fallback;
  }
};

/**
 * GET /kids/:kidId/progress  (parent only, own children only)
 * Everything a parent wants to know about one child in one answer: level, streak, courses and how far they are,
 * what they finished recently, quiz scores, projects and marks, badges, the last 30 days, and screen time.
 */
export const getKidProgress = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = req.user?.id;
    if (!parentId) return next(new AppError('Unauthorized access.', 401));
    const kidId = req.params.kidId as string;

    const kidRes = await pool.query(
      `SELECT id, name, age, age_group, grade, avatar, COALESCE(total_points, 0) AS total_points,
              COALESCE(streak_days, 0) AS streak_days, last_activity_date::text AS last_activity_date,
              last_kid_login_at, leaderboard_opt_in, created_at, screen_time_daily_minutes,
              username, (pin_hash IS NOT NULL) AS has_pin, COALESCE(break_every_minutes, 30) AS break_every_minutes
         FROM kids WHERE id = $1 AND parent_id = $2`,
      [kidId, parentId]
    );
    const kid = kidRes.rows[0];
    if (!kid) return next(new AppError('Child not found or does not belong to you.', 404));

    const points = Number(kid.total_points);
    const level = Math.floor(points / POINTS_PER_LEVEL) + 1;

    const courses = (
      await pool.query(
        `SELECT e.id AS enrollment_id, e.course_id, e.course_name, e.status, e.payment_status, e.trial_ends_at,
                e.fee_amount, e.billing_cycle, e.next_payment_date::text AS next_payment_date, e.total_paid,
                e.last_payment_date, e.start_date::text AS start_date, e.pay_ref,
                (e.status = 'active' AND ${trialStillValid('e')}) AS learning_now,
                (SELECT COUNT(*)::int FROM lessons l JOIN modules m ON m.id = l.module_id
                  WHERE m.course_id = e.course_id AND ${lessonVisibleSql('l', 1)}) AS total_lessons,
                (SELECT COUNT(*)::int FROM kid_progress kp JOIN lessons l ON l.id = kp.lesson_id JOIN modules m ON m.id = l.module_id
                  WHERE kp.enrollment_id = e.id AND kp.kid_id = $1 AND kp.completed = true AND m.course_id = e.course_id) AS completed_lessons,
                (SELECT MAX(kp.completed_at) FROM kid_progress kp WHERE kp.enrollment_id = e.id AND kp.kid_id = $1 AND kp.completed = true) AS last_activity,
                (SELECT l.title FROM lessons l JOIN modules m ON m.id = l.module_id
                  WHERE m.course_id = e.course_id AND ${lessonVisibleSql('l', 1)}
                    AND NOT EXISTS (SELECT 1 FROM kid_progress kp WHERE kp.lesson_id = l.id AND kp.kid_id = $1 AND kp.completed = true)
                  ORDER BY m.order_index, l.order_index LIMIT 1) AS next_lesson
           FROM enrollments e
          WHERE e.kid_id = $1 AND e.parent_id = $2
          ORDER BY (e.status = 'active') DESC, e.created_at DESC`,
        [kidId, parentId]
      )
    ).rows.map((c) => ({
      ...c,
      progress: c.total_lessons > 0 ? Math.min(100, Math.round((c.completed_lessons / c.total_lessons) * 100)) : 0,
    }));

    const recent = (
      await pool.query(
        `SELECT l.title AS lesson, e.course_name, kp.points_earned, kp.completed_at
           FROM kid_progress kp
           JOIN lessons l ON l.id = kp.lesson_id
           LEFT JOIN enrollments e ON e.id = kp.enrollment_id
          WHERE kp.kid_id = $1 AND kp.completed = true
          ORDER BY kp.completed_at DESC NULLS LAST LIMIT 15`,
        [kidId]
      )
    ).rows;

    const quizzes = await optional(
      async () =>
        (
          await pool.query(
            `SELECT l.title AS lesson, q.score, q.total, q.created_at
               FROM quiz_submissions q JOIN lessons l ON l.id = q.lesson_id
              WHERE q.student_id = $1 ORDER BY q.created_at DESC LIMIT 15`,
            [kidId]
          )
        ).rows,
      [] as { lesson: string; score: number; total: number; created_at: string }[]
    );

    const projects = (
      await pool.query(
        `SELECT p.id, p.title, p.kind, l.title AS lesson, p.submitted_at, p.marks, p.feedback, p.reviewed_at, p.updated_at
           FROM kid_projects p LEFT JOIN lessons l ON l.id = p.lesson_id
          WHERE p.kid_id = $1 ORDER BY p.updated_at DESC LIMIT 50`,
        [kidId]
      )
    ).rows;

    const handIns = (
      await pool.query(
        `SELECT l.title AS lesson, s.status, s.marks, s.feedback, s.submitted_at, s.reviewed_at
           FROM submissions s JOIN lessons l ON l.id = s.lesson_id
          WHERE s.kid_id = $1 AND s.parent_id = $2 ORDER BY s.submitted_at DESC LIMIT 30`,
        [kidId, parentId]
      )
    ).rows;

    const earned = (await pool.query('SELECT name, icon, earned_at FROM kid_badges WHERE kid_id = $1 ORDER BY earned_at', [kidId])).rows;
    const completedTotal = Number(
      (await pool.query('SELECT COUNT(DISTINCT lesson_id)::int AS n FROM kid_progress WHERE kid_id = $1 AND completed = true', [kidId])).rows[0].n
    );
    const badges = [
      ...MILESTONES.map((m) => ({ name: m.name, icon: m.icon, earned: completedTotal >= m.at, needed: Math.max(0, m.at - completedTotal) })),
      ...earned
        .filter((b) => !MILESTONES.some((m) => m.name === b.name))
        .map((b) => ({ name: b.name, icon: b.icon ?? '🏅', earned: true, needed: 0, earned_at: b.earned_at })),
    ];

    const calendar = (
      await pool.query(
        `SELECT activity_date::text AS day, lessons_completed, points_earned FROM learning_calendar
          WHERE kid_id = $1 AND activity_date > (now() AT TIME ZONE 'Africa/Nairobi')::date - 30 ORDER BY activity_date`,
        [kidId]
      )
    ).rows;

    // Lesson by lesson, for every course the child is enrolled in (only lessons their age group sees).
    const outline = (
      await pool.query(
        `SELECT m.course_id, m.id AS module_id, m.title AS module, m.order_index AS module_order,
                l.id AS lesson_id, l.title AS lesson, l.lesson_type, (l.assignment IS NOT NULL AND l.assignment <> '') AS has_assignment,
                l.order_index AS lesson_order, kp.completed AS done, kp.completed_at, kp.points_earned
           FROM modules m
           JOIN lessons l ON l.module_id = m.id AND ${lessonVisibleSql('l', 1)}
           LEFT JOIN kid_progress kp ON kp.lesson_id = l.id AND kp.kid_id = $1 AND kp.completed = true
          WHERE m.course_id IN (SELECT course_id FROM enrollments WHERE kid_id = $1 AND parent_id = $2 AND course_id IS NOT NULL)
          ORDER BY m.order_index, l.order_index`,
        [kidId, parentId]
      )
    ).rows;
    const bestQuiz = await optional(
      async () =>
        (await pool.query(`SELECT lesson_id, MAX(score) AS score, MAX(total) AS total FROM quiz_submissions WHERE student_id = $1 GROUP BY lesson_id`, [kidId])).rows,
      [] as { lesson_id: string; score: number; total: number }[]
    );
    const quizOf = new Map(bestQuiz.map((q) => [q.lesson_id, q]));
    const outlineByCourse: Record<string, { module: string; lessons: object[] }[]> = {};
    for (const r of outline) {
      const mods = (outlineByCourse[r.course_id] ??= []);
      let mod = mods.find((m) => (m as { id?: string }).id === r.module_id) as ({ id?: string; module: string; lessons: object[] }) | undefined;
      if (!mod) { mod = { id: r.module_id, module: r.module, lessons: [] }; mods.push(mod); }
      const q = quizOf.get(r.lesson_id);
      mod.lessons.push({
        title: r.lesson, type: r.lesson_type, has_assignment: r.has_assignment, done: !!r.done, completed_at: r.completed_at, points: r.done ? r.points_earned : 0,
        quiz: q ? { score: Number(q.score), total: Number(q.total) } : null,
      });
    }
    const coursesWithOutline = courses.map((c) => ({ ...c, modules: outlineByCourse[c.course_id as string] ?? [] }));

    const usage = (
      await pool.query(
        `SELECT COALESCE(SUM(seconds), 0)::int AS total, COALESCE(SUM(seconds) FILTER (WHERE day > (now() AT TIME ZONE 'Africa/Nairobi')::date - 30), 0)::int AS last30,
                COUNT(*) FILTER (WHERE seconds > 0)::int AS days
           FROM kid_usage_daily WHERE kid_id = $1`,
        [kidId]
      )
    ).rows[0];
    const consent = await optional(
      async () => (await pool.query('SELECT policy_version FROM parental_consents WHERE kid_id = $1 AND withdrawn_at IS NULL ORDER BY accepted_at DESC LIMIT 1', [kidId])).rows[0] as { policy_version: string } | undefined,
      undefined
    );
    const weeks = (
      await pool.query(
        `SELECT COUNT(*) FILTER (WHERE completed_at > now() - interval '7 days')::int AS this_week,
                COUNT(*) FILTER (WHERE completed_at <= now() - interval '7 days' AND completed_at > now() - interval '14 days')::int AS last_week
           FROM kid_progress WHERE kid_id = $1 AND completed = true`,
        [kidId]
      )
    ).rows[0];

    const marked = [...projects, ...handIns].filter((x) => x.marks !== null && x.marks !== undefined);
    const quizPct = quizzes.filter((q) => q.total > 0).map((q) => (q.score / q.total) * 100);
    const avg = (a: number[]) => (a.length ? Math.round(a.reduce((s, n) => s + n, 0) / a.length) : null);

    res.status(200).json({
      status: 'success',
      data: {
        kid: {
          id: kid.id, name: kid.name, age: kid.age, age_group: kid.age_group, grade: kid.grade, avatar: kid.avatar,
          joined: kid.created_at, last_login: kid.last_kid_login_at, last_activity_date: kid.last_activity_date,
          leaderboard_opt_in: !!kid.leaderboard_opt_in,
          username: kid.username ?? null, has_pin: !!kid.has_pin,
          consent_ok: consent?.policy_version === CONSENT_VERSION,
        },
        time_spent: { total_seconds: usage.total, last_30_days_seconds: usage.last30, learning_days: usage.days },
        level: {
          level, points, points_in_level: points % POINTS_PER_LEVEL, points_per_level: POINTS_PER_LEVEL,
          points_to_next: level * POINTS_PER_LEVEL - points, streak_days: Number(kid.streak_days),
        },
        totals: {
          lessons_completed: completedTotal,
          lessons_this_week: weeks.this_week,
          lessons_last_week: weeks.last_week,
          projects_made: projects.length,
          projects_handed_in: projects.filter((p) => p.submitted_at).length + handIns.length,
          average_mark: avg(marked.map((m) => Number(m.marks))),
          average_quiz_percent: avg(quizPct),
        },
        courses: coursesWithOutline,
        recent,
        quizzes,
        projects,
        hand_ins: handIns,
        badges,
        calendar,
        screen_time: { limit_minutes: kid.screen_time_daily_minutes, today: await getScreenTimeStatus(kid.id), last_7_days: await getWeeklyUsage(kid.id) },
      },
    });
  } catch (error) {
    next(error);
  }
};
