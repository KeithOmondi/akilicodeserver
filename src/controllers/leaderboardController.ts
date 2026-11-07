import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { AppError } from '../utils/appError';

/**
 * GET /kids/leaderboard — a friendlier replacement for the old global ranking.
 *
 *  - Everyone gets "personal best": this week vs. their best week, and their streak.
 *    Nothing here involves any other child.
 *  - The ranking is OPT-IN, decided by the parent. A child who is not opted in sees no one,
 *    and is seen by no one. Opted-in children appear by nickname and avatar only; no ids,
 *    no names of parents, no ages — a rank list cannot be used to identify or look up a child.
 */
export const getLeaderboard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kidId = req.user?.id;
    if (!kidId) return next(new AppError('Unauthorized access.', 401));
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 20);

    const me = (await pool.query(
      `SELECT total_points, COALESCE(streak_days, 0) AS streak_days, leaderboard_opt_in FROM kids WHERE id = $1`,
      [kidId]
    )).rows[0];
    if (!me) return next(new AppError('Child not found.', 404));

    // Points per week, from lessons the child completed.
    const weeks = (await pool.query(
      `SELECT date_trunc('week', completed_at)::date::text AS week, COALESCE(SUM(points_earned), 0)::int AS points
         FROM kid_progress WHERE kid_id = $1 AND completed = true AND completed_at IS NOT NULL
        GROUP BY 1 ORDER BY 1 DESC`,
      [kidId]
    )).rows as { week: string; points: number }[];
    const thisWeek = (await pool.query(`SELECT date_trunc('week', now())::date::text AS w`)).rows[0].w;
    const thisWeekPoints = weeks.find((w) => String(w.week).slice(0, 10) === thisWeek)?.points ?? 0;
    const bestWeekPoints = weeks.reduce((m, w) => Math.max(m, w.points), 0);

    const personalBest = {
      total_points: me.total_points ?? 0,
      streak_days: me.streak_days,
      this_week_points: thisWeekPoints,
      best_week_points: Math.max(bestWeekPoints, thisWeekPoints),
      is_best_week: thisWeekPoints > 0 && thisWeekPoints >= bestWeekPoints,
    };

    let leaderboard: { rank: number; name: string; avatar: string | null; total_points: number; is_me: boolean }[] = [];
    if (me.leaderboard_opt_in) {
      const rows = (await pool.query(
        `SELECT id, name, avatar, total_points FROM kids
          WHERE leaderboard_opt_in = true AND total_points > 0
          ORDER BY total_points DESC, id LIMIT $1`,
        [limit]
      )).rows;
      leaderboard = rows.map((k, i) => ({
        rank: i + 1, name: k.name, avatar: k.avatar, total_points: k.total_points, is_me: k.id === kidId,
      }));
    }

    res.status(200).json({
      status: 'success',
      data: { opted_in: !!me.leaderboard_opt_in, personal_best: personalBest, leaderboard },
    });
  } catch (error) {
    next(error);
  }
};
