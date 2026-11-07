import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../config/db';
import env from '../config/env';
import { AppError } from '../utils/appError';
import { sendToken } from '../utils/sendToken';
import { checkKidPin, KidLoginRow } from '../services/kidAccess';
import { CONSENT_ITEMS, CONSENT_VERSION, consentDocument } from '../services/consent';
import { getScreenTimeStatus, getWeeklyUsage, recordHeartbeat } from '../services/screenTime';
import { exportKidData, deleteKid } from '../services/dataLifecycle';
import { signDeviceToken, verifyDeviceToken, DEVICE_TTL_DAYS } from '../services/tokens';

const parentIdOf = (req: Request) => {
  const id = req.user?.id;
  if (!id) throw new AppError('Unauthorized access.', 401);
  return id;
};

const KID_PUBLIC = `id, parent_id, name, age, birth_year, grade, avatar, username,
  CASE WHEN pin_hash IS NOT NULL THEN true ELSE false END AS has_pin,
  screen_time_daily_minutes, break_every_minutes, created_at`;

const ownKid = async (parentId: string, kidId: string) => {
  const r = await pool.query('SELECT id, name FROM kids WHERE id = $1 AND parent_id = $2', [kidId, parentId]);
  if (!r.rows[0]) throw new AppError('Child not found or does not belong to you.', 404);
  return r.rows[0] as { id: string; name: string };
};

// ── Consent ──────────────────────────────────────────────────────────────────

/** GET /kids/consent-document — what the parent is shown and agrees to. Public. */
export const getConsentDocument = (_req: Request, res: Response) => {
  res.status(200).json({ status: 'success', data: consentDocument() });
};

const insertConsent = (client: { query: typeof pool.query }, parentId: string, kidId: string, req: Request) =>
  client.query(
    `INSERT INTO parental_consents (parent_id, kid_id, policy_version, is_guardian, items, ip, user_agent)
     VALUES ($1, $2, $3, true, $4, $5, $6)`,
    [parentId, kidId, CONSENT_VERSION, JSON.stringify(CONSENT_ITEMS), (req.ip ?? '').slice(0, 64), (req.get('user-agent') ?? '').slice(0, 300)]
  );

/**
 * POST /kids/register
 * The child profile and the consent record are created in ONE transaction:
 * there is never a profile without a consent record. Body must contain
 * consent: { accepted: true, is_guardian: true, version } (see registerKidSchema).
 */
export const registerKid = async (req: Request, res: Response, next: NextFunction) => {
  const client = await pool.connect();
  try {
    const parentId = parentIdOf(req);
    const { name, age, birth_year, grade, avatar, consent } = req.body;

    if (consent.version !== CONSENT_VERSION) {
      return next(new AppError('The consent text has been updated. Please read and accept it again.', 409));
    }

    const count = await client.query('SELECT count(*)::int AS c FROM kids WHERE parent_id = $1', [parentId]);
    if (count.rows[0].c >= 10) return next(new AppError('You can add up to 10 children.', 400));

    await client.query('BEGIN');
    const kid = await client.query(
      `INSERT INTO kids (parent_id, name, age, birth_year, grade, avatar)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${KID_PUBLIC}`,
      [parentId, name, age, birth_year ?? null, grade ?? null, avatar ?? null]
    );
    await insertConsent(client, parentId, kid.rows[0].id, req);
    await client.query('COMMIT');

    res.status(201).json({ status: 'success', data: { kid: kid.rows[0] } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    next(error);
  } finally {
    client.release();
  }
};

/** POST /kids/:kidId/consent — record consent for a child created before consent existed, or accept a newer wording. */
export const recordConsentForExistingKid = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = parentIdOf(req);
    const kid = await ownKid(parentId, req.params.kidId as string);
    if (req.body.consent.version !== CONSENT_VERSION) {
      return next(new AppError('The consent text has been updated. Please read and accept it again.', 409));
    }
    const existing = await pool.query(
      'SELECT 1 FROM parental_consents WHERE kid_id = $1 AND withdrawn_at IS NULL AND policy_version = $2 LIMIT 1',
      [kid.id, CONSENT_VERSION]);
    if (existing.rows.length === 0) await insertConsent(pool, parentId, kid.id, req);
    res.status(200).json({ status: 'success', message: 'Consent recorded.' });
  } catch (error) {
    next(error);
  }
};

// ── List ─────────────────────────────────────────────────────────────────────

/**
 * GET /kids/my-kids — everything the parent dashboard needs about each child, including
 * which consent wording they accepted and whether they must re-accept a newer one.
 */
export const listMyKids = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = parentIdOf(req);
    const r = await pool.query(
      `SELECT ${KID_PUBLIC}, pin_reset_required, leaderboard_opt_in,
              (SELECT c.policy_version FROM parental_consents c
                WHERE c.kid_id = kids.id AND c.withdrawn_at IS NULL ORDER BY c.accepted_at DESC LIMIT 1) AS consent_version
         FROM kids WHERE parent_id = $1 ORDER BY created_at DESC`,
      [parentId]
    );
    const kids = r.rows.map((k) => ({
      ...k,
      // legacy children (no consent row yet) and children on an older wording both need the parent to accept
      needs_consent: k.consent_version !== CONSENT_VERSION,
    }));
    res.status(200).json({ status: 'success', results: kids.length, data: { kids } });
  } catch (error) {
    next(error);
  }
};

/** PUT /kids/:kidId/leaderboard  { opt_in }  — the parent decides if the child appears on the (nickname-only) leaderboard. */
export const setLeaderboardOptIn = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kid = await ownKid(parentIdOf(req), req.params.kidId as string);
    await pool.query('UPDATE kids SET leaderboard_opt_in = $2 WHERE id = $1', [kid.id, req.body.opt_in === true]);
    res.status(200).json({ status: 'success', data: { leaderboard_opt_in: req.body.opt_in === true } });
  } catch (error) {
    next(error);
  }
};

// ── PIN without username (family-device picker) ──────────────────────────────

/** PUT /kids/:kidId/pin  { pin }  (parent gate) */
export const setKidPin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kid = await ownKid(parentIdOf(req), req.params.kidId as string);
    const hash = await bcrypt.hash(req.body.pin, 12);
    await pool.query(
      'UPDATE kids SET pin_hash = $1, pin_failed_attempts = 0, pin_locked_until = NULL, pin_reset_required = false WHERE id = $2',
      [hash, kid.id]
    );
    res.status(200).json({ status: 'success', message: 'PIN saved.' });
  } catch (error) {
    next(error);
  }
};

// ── Family device + picker ───────────────────────────────────────────────────

const deviceCookie = {
  httpOnly: true,
  secure: env.IS_PRODUCTION,
  sameSite: 'lax' as const,
  path: '/api/v1/kids',
};

/** POST /kids/device/link — mark THIS browser as a family device (parent gate). */
export const linkDevice = (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = parentIdOf(req);
    res.cookie('akili_device', signDeviceToken(parentId), { ...deviceCookie, maxAge: DEVICE_TTL_DAYS * 86400 * 1000 });
    res.status(200).json({ status: 'success', message: 'This device can now show your children’s login screen.' });
  } catch (error) {
    next(error);
  }
};

/** DELETE /kids/device/link */
export const unlinkDevice = (_req: Request, res: Response) => {
  res.clearCookie('akili_device', deviceCookie);
  res.status(200).json({ status: 'success', message: 'This device no longer shows the children’s login screen.' });
};

const deviceParent = (req: Request): string => {
  const pid = req.cookies?.akili_device ? verifyDeviceToken(req.cookies.akili_device) : null;
  if (!pid) throw new AppError('This device is not set up for children yet. Ask a parent to log in and set it up.', 401);
  return pid;
};

/** GET /kids/picker — avatars and nicknames only. Nothing else leaves the server. */
export const picker = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = deviceParent(req);
    const r = await pool.query(
      `SELECT id, name, avatar, (pin_hash IS NULL) AS needs_new_pin
         FROM kids WHERE parent_id = $1 AND (pin_hash IS NOT NULL OR pin_reset_required) ORDER BY created_at`,
      [parentId]
    );
    res.status(200).json({ status: 'success', data: { kids: r.rows } });
  } catch (error) {
    next(error);
  }
};

/** POST /kids/picker/login  { kid_id, pin } */
export const pickerLogin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = deviceParent(req);
    const { kid_id, pin } = req.body as { kid_id: string; pin: string };
    const r = await pool.query(
      `SELECT id, parent_id, name, age, grade, avatar, username, pin_hash, pin_locked_until, pin_reset_required
         FROM kids WHERE id = $1 AND parent_id = $2`,
      [kid_id, parentId]
    );
    const kid = await checkKidPin(r.rows[0] as KidLoginRow | undefined, pin, req.ip, true);
    sendToken({ ...kid, role: 'kid' }, 200, res, 'kid');
  } catch (error) {
    next(error);
  }
};

/** POST /kids/login  { username, pin } — still supported for logging in on any device. */
export const kidLogin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, pin } = req.body as { username: string; pin: string };
    const r = await pool.query(
      `SELECT id, parent_id, name, age, grade, avatar, username, pin_hash, pin_locked_until
         FROM kids WHERE username = $1`,
      [username]
    );
    const kid = await checkKidPin(r.rows[0] as KidLoginRow | undefined, pin, req.ip);
    sendToken({ ...kid, role: 'kid' }, 200, res, 'kid');
  } catch (error) {
    next(error);
  }
};

// ── Screen time ──────────────────────────────────────────────────────────────

/** PUT /kids/:kidId/screen-time  { daily_limit_minutes: number | null, break_every_minutes? }  (parent gate) */
export const setScreenTime = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kid = await ownKid(parentIdOf(req), req.params.kidId as string);
    const { daily_limit_minutes, break_every_minutes } = req.body as {
      daily_limit_minutes?: number | null; break_every_minutes?: number;
    };
    await pool.query(
      `UPDATE kids SET
         screen_time_daily_minutes = CASE WHEN $2::boolean THEN $3::int ELSE screen_time_daily_minutes END,
         break_every_minutes = COALESCE($4::int, break_every_minutes)
       WHERE id = $1`,
      [kid.id, daily_limit_minutes !== undefined, daily_limit_minutes ?? null, break_every_minutes ?? null]
    );
    res.status(200).json({ status: 'success', data: { screen_time: await getScreenTimeStatus(kid.id) } });
  } catch (error) {
    next(error);
  }
};

/** GET /kids/:kidId/screen-time — for the parent dashboard. */
export const getScreenTime = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kid = await ownKid(parentIdOf(req), req.params.kidId as string);
    res.status(200).json({
      status: 'success',
      data: { today: await getScreenTimeStatus(kid.id), last_7_days: await getWeeklyUsage(kid.id) },
    });
  } catch (error) {
    next(error);
  }
};

/** POST /kids/me/heartbeat  { seconds } — the child's page, about once a minute. */
export const heartbeat = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await recordHeartbeat(req.user!.id, Number(req.body.seconds));
    res.status(200).json({ status: 'success', data: { screen_time: status } });
  } catch (error) {
    next(error);
  }
};

/** GET /kids/me/screen-time — the child sees how much time is left. */
export const myScreenTime = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ status: 'success', data: { screen_time: await getScreenTimeStatus(req.user!.id) } });
  } catch (error) {
    next(error);
  }
};

// ── Export & delete ──────────────────────────────────────────────────────────

/** GET /kids/:kidId/export  (parent gate) */
export const exportKid = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await exportKidData(parentIdOf(req), req.params.kidId as string);
    res.setHeader('Content-Disposition', `attachment; filename="akili-child-data.json"`);
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

/** DELETE /kids/:kidId  { confirm_name }  (parent gate) */
export const removeKid = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteKid(parentIdOf(req), req.params.kidId as string, req.body.confirm_name);
    res.status(200).json({ status: 'success', message: 'Your child’s profile and all of their data have been deleted.' });
  } catch (error) {
    next(error);
  }
};
