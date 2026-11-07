import pool from '../config/db';

/** Calendar day in Kenya, computed by the database so server timezone never matters. */
const TODAY = `(now() AT TIME ZONE 'Africa/Nairobi')::date`;

export type ScreenTimeStatus = {
  limit_minutes: number | null;   // null = no limit set by the parent
  used_seconds: number;
  remaining_seconds: number | null;
  locked: boolean;
  break_every_minutes: number;
  break_due: boolean;
};

export const getScreenTimeStatus = async (kidId: string): Promise<ScreenTimeStatus | null> => {
  const { rows } = await pool.query(
    `SELECT k.screen_time_daily_minutes AS lim, k.break_every_minutes AS brk,
            COALESCE(u.seconds, 0) AS used
       FROM kids k
       LEFT JOIN kid_usage_daily u ON u.kid_id = k.id AND u.day = ${TODAY}
      WHERE k.id = $1`,
    [kidId]
  );
  const r = rows[0];
  if (!r) return null;
  const used = Number(r.used);
  const limit: number | null = r.lim === null ? null : Number(r.lim);
  const remaining = limit === null ? null : Math.max(0, limit * 60 - used);
  return {
    limit_minutes: limit,
    used_seconds: used,
    remaining_seconds: remaining,
    locked: limit !== null && used >= limit * 60,
    break_every_minutes: Number(r.brk),
    // A gentle nudge each time another full break interval has been used up.
    break_due: used > 0 && used % (Number(r.brk) * 60) < 60,
  };
};

/**
 * The learning page pings this about once a minute while the child is active.
 * Time added is the SMALLEST of: what the page claims, time since the last ping,
 * and 65 s — so a script cannot inflate or skip the counter.
 */
export const recordHeartbeat = async (kidId: string, claimedSeconds: number) => {
  const claimed = Math.max(0, Math.min(65, Math.floor(claimedSeconds)));
  await pool.query(
    `INSERT INTO kid_usage_daily (kid_id, day, seconds, last_beat)
     VALUES ($1, ${TODAY}, 0, now())
     ON CONFLICT (kid_id, day) DO UPDATE
       SET seconds = kid_usage_daily.seconds + LEAST(
             $2::int,
             65,
             COALESCE(EXTRACT(EPOCH FROM (now() - kid_usage_daily.last_beat))::int, 0)
           ),
           last_beat = now()`,
    [kidId, claimed]
  );
  return getScreenTimeStatus(kidId);
};

export const getWeeklyUsage = async (kidId: string) => {
  const { rows } = await pool.query(
    `SELECT day::text, seconds FROM kid_usage_daily
      WHERE kid_id = $1 AND day > ${TODAY} - 7 ORDER BY day`,
    [kidId]
  );
  return rows as { day: string; seconds: number }[];
};
