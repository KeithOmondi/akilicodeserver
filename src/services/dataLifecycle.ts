import { PoolClient } from 'pg';
import pool from '../config/db';
import { AppError } from '../utils/appError';

/**
 * Export and deletion of personal data.
 *
 * Money records are kept (tax / accounting duty) but cut loose from the person:
 * payments lose their kid/parent/enrollment links and any name in the description.
 * Everything else about the child is deleted.
 */

const audit = (client: PoolClient, action: string, userId: string | null, details: object) =>
  client.query(
    `INSERT INTO audit_logs (id, action, user_id, details) VALUES (gen_random_uuid(), $1, $2, $3)`,
    [action, userId, JSON.stringify(details)]
  );

// ── Export ───────────────────────────────────────────────────────────────────

const rows = async (sql: string, params: unknown[]) => (await pool.query(sql, params)).rows;

export const exportKidData = async (parentId: string, kidId: string) => {
  const kid = (await rows(
    `SELECT id, name, age, birth_year, grade, avatar, username, total_points, streak_days,
            last_activity_date, screen_time_daily_minutes, break_every_minutes, created_at
       FROM kids WHERE id = $1 AND parent_id = $2`, [kidId, parentId]))[0];
  if (!kid) throw new AppError('Child not found.', 404);

  return {
    exported_at: new Date().toISOString(),
    note: 'Everything AKILI holds about this child. The PIN is stored only as a one-way hash and is not included.',
    child: kid,
    consents: await rows(`SELECT policy_version, items, accepted_at, withdrawn_at FROM parental_consents WHERE kid_id = $1`, [kidId]),
    enrollments: await rows(`SELECT course_name, billing_cycle, fee_amount, status, payment_status, start_date, pay_ref FROM enrollments WHERE kid_id = $1`, [kidId]),
    progress: await rows(`SELECT * FROM kid_progress WHERE kid_id = $1`, [kidId]),
    submissions: await rows(`SELECT * FROM submissions WHERE kid_id = $1`, [kidId]),
    badges: await rows(`SELECT name, points_awarded, earned_at FROM kid_badges WHERE kid_id = $1`, [kidId]),
    calendar: await rows(`SELECT * FROM calendar_events WHERE kid_id = $1`, [kidId]),
    learning_calendar: await rows(`SELECT * FROM learning_calendar WHERE kid_id = $1`, [kidId]),
    testimonials: await rows(`SELECT rating, title, content, status, created_at FROM testimonials WHERE kid_id = $1`, [kidId]),
    trials: await rows(`SELECT * FROM trial_access WHERE kid_id = $1`, [kidId]),
    coding_projects: await rows(`SELECT title, html, css, js, submitted_at, marks, feedback, created_at, updated_at FROM kid_projects WHERE kid_id = $1`, [kidId]),
    code_snippets: await rows(`SELECT * FROM code_snippets WHERE user_id = $1`, [kidId]),
    screen_time_last_7_days: await rows(`SELECT day::text, seconds FROM kid_usage_daily WHERE kid_id = $1 AND day > current_date - 8 ORDER BY day`, [kidId]),
    payments: await rows(`SELECT receipt_number, amount, method, status, date FROM payments WHERE kid_id = $1`, [kidId]),
  };
};

export const exportParentData = async (parentId: string) => {
  const user = (await rows(
    `SELECT id, name, email, phone, role, is_verified, phone_verified, created_at FROM users WHERE id = $1`, [parentId]))[0];
  if (!user) throw new AppError('Account not found.', 404);
  const kids = await rows(`SELECT id FROM kids WHERE parent_id = $1`, [parentId]);
  return {
    exported_at: new Date().toISOString(),
    account: user,
    consents: await rows(`SELECT kid_id, policy_version, items, accepted_at, withdrawn_at FROM parental_consents WHERE parent_id = $1`, [parentId]),
    payments: await rows(`SELECT receipt_number, amount, method, status, date, description FROM payments WHERE parent_id = $1 ORDER BY date`, [parentId]),
    children: await Promise.all(kids.map((k) => exportKidData(parentId, k.id))),
  };
};

// ── Deletion ─────────────────────────────────────────────────────────────────

const detachPaymentsOfKid = (client: PoolClient, kidId: string) =>
  client.query(
    `UPDATE payments SET kid_id = NULL, enrollment_id = NULL, description = 'Course fee'
      WHERE kid_id = $1`, [kidId]);

const assertNoPaymentInFlight = async (client: PoolClient, where: 'kid_id' | 'parent_id', id: string) => {
  const r = await client.query(
    `SELECT 1 FROM payments WHERE ${where} = $1 AND status IN ('pending','review') LIMIT 1`, [id]);
  if (r.rows.length > 0) {
    throw new AppError('A payment is still being confirmed. Please try again in a few minutes.', 409);
  }
};

/** Delete one child and everything attached to them. */
export const deleteKid = async (parentId: string, kidId: string, confirmName: string) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const kid = (await client.query(`SELECT id, name FROM kids WHERE id = $1 AND parent_id = $2 FOR UPDATE`, [kidId, parentId])).rows[0];
    if (!kid) throw new AppError('Child not found.', 404);
    if (kid.name.trim().toLowerCase() !== confirmName.trim().toLowerCase()) {
      throw new AppError('The name you typed does not match.', 400);
    }
    await assertNoPaymentInFlight(client, 'kid_id', kidId);

    await detachPaymentsOfKid(client, kidId);
    await client.query(`UPDATE parental_consents SET withdrawn_at = now() WHERE kid_id = $1 AND withdrawn_at IS NULL`, [kidId]);
    await client.query(`DELETE FROM kids WHERE id = $1`, [kidId]);   // cascades progress, submissions, badges, usage …
    await audit(client, 'KID_DELETED', parentId, { kid_id: kidId });
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

/** Delete a parent account, all their children, and every personal detail. */
export const deleteParentAccount = async (parentId: string) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user = (await client.query(`SELECT id, role FROM users WHERE id = $1 FOR UPDATE`, [parentId])).rows[0];
    if (!user) throw new AppError('Account not found.', 404);
    if (user.role !== 'parent') throw new AppError('Only parent accounts can be deleted here.', 403);
    await assertNoPaymentInFlight(client, 'parent_id', parentId);

    const kids = (await client.query(`SELECT id FROM kids WHERE parent_id = $1`, [parentId])).rows;
    for (const k of kids) await detachPaymentsOfKid(client, k.id);

    await client.query(`UPDATE payments SET parent_id = NULL, kid_id = NULL, enrollment_id = NULL, description = 'Course fee' WHERE parent_id = $1`, [parentId]);
    await client.query(`UPDATE submissions SET parent_id = NULL WHERE parent_id = $1`, [parentId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [parentId]);   // cascades kids, enrollments, consents, testimonials …
    await audit(client, 'PARENT_ACCOUNT_DELETED', null, { user_id: parentId, children: kids.length });
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};
