/**
 * The 7-day free trial. Runs the REAL SQL against an in-process Postgres (pglite) with the real schema and migrations.
 * Rules under test: one trial per child; a trial is a time-limited active enrollment; access ends at the exact moment
 * the trial ends (even before the clean-up job runs); paying turns it into a normal paid enrollment.
 */
import './setup';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

let db: any;
let T: typeof import('../src/controllers/trialController');
let L: typeof import('../src/controllers/kidLearningController');
let E: typeof import('../src/controllers/enrollmentController');
let svc: typeof import('../src/services/paymentService');
let trial: typeof import('../src/utils/trial');

const fakeModule = (file: string, exports: any) => {
  const id = require.resolve(file);
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] } as any;
};

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { uuid_ossp } = await import('@electric-sql/pglite/contrib/uuid_ossp');
  db = new PGlite({ extensions: { uuid_ossp } });
  const root = path.join(__dirname, '..');
  await db.exec(fs.readFileSync(path.join(root, 'schema/schema.sql'), 'utf8').replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/, ''));
  for (const m of ['001_payment_hardening', '002_phase2_accounts', '003_pin_reset_and_leaderboard', '004_kid_projects', '005_age_groups_and_blocks', '007_free_trial']) {
    await db.exec(fs.readFileSync(path.join(root, `migrations/${m}.sql`), 'utf8'));
  }
  const run = async (sql: string, params?: any[]) => {
    const r = await db.query(sql, params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  fakeModule('../src/config/db', { __esModule: true, default: { query: run, connect: async () => ({ query: run, release() {} }), on() {} }, query: run });
  fakeModule('../src/utils/mailsTemplate', { sendReceiptEmail: async () => {} });
  fakeModule('../src/utils/mpesa', { querySTKStatus: async () => ({ ResultCode: '4999' }) });
  T = require('../src/controllers/trialController');
  L = require('../src/controllers/kidLearningController');
  E = require('../src/controllers/enrollmentController');
  svc = require('../src/services/paymentService');
  trial = require('../src/utils/trial');
});

const call = async (handler: any, req: any) => {
  let body: any; let status = 200; let error: any = null;
  const res: any = { status(c: number) { status = c; return res; }, json(b: any) { body = b; return res; } };
  await handler(req, res, (e: any) => { error = e; });
  return { status, body, error };
};
const asParent = (id: string, extra: any = {}) => ({ user: { id, role: 'parent' }, params: {}, body: {}, query: {}, ...extra });
const asKid = (id: string, extra: any = {}) => ({ user: { id, role: 'kid' }, params: {}, body: {}, query: {}, ...extra });

let n = 0;
/** A parent, a child, a course with one lesson, and an UNPAID enrollment for it. */
const world = async (opts: { trialAvailable?: boolean; trialDays?: number | null } = {}) => {
  n++;
  const parent = (await db.query(`INSERT INTO users (name,email,phone,password,is_verified) VALUES ('P',$1,$2,'x',true) RETURNING id`, [`t${n}@x.co`, `07${60000000 + n}`])).rows[0].id;
  const kid = (await db.query(`INSERT INTO kids (parent_id,name,age,age_group) VALUES ($1,'K',8,'7-9') RETURNING id`, [parent])).rows[0].id;
  const course = (await db.query(`INSERT INTO courses (title, price, is_trial_available) VALUES ($1, 4000, $2) RETURNING id`, [`C${n}`, opts.trialAvailable ?? true])).rows[0].id;
  if (opts.trialDays !== undefined) await db.query(`UPDATE courses SET trial_duration_days = $2 WHERE id = $1`, [course, opts.trialDays]);
  const mod = (await db.query(`INSERT INTO modules (course_id, title) VALUES ($1,'M') RETURNING id`, [course])).rows[0].id;
  const lesson = (await db.query(`INSERT INTO lessons (module_id,title,notes,order_index) VALUES ($1,'L1','notes',1) RETURNING id`, [mod])).rows[0].id;
  const enroll = async (courseId = course) =>
    (await db.query(`INSERT INTO enrollments (kid_id,parent_id,course_id,course_name,fee_amount,billing_cycle,status) VALUES ($1,$2,$3,'Course',4000,'monthly','pending') RETURNING id`, [kid, parent, courseId])).rows[0].id;
  return { parent, kid, course, lesson, enroll, enrollment: await enroll() };
};
const enrRow = async (id: string) => (await db.query('SELECT * FROM enrollments WHERE id = $1', [id])).rows[0];
const start = (w: { parent: string }, enrollment: string) => call(T.startFreeTrial, asParent(w.parent, { body: { enrollment_id: enrollment } }));
const kidCourses = async (kid: string) => (await call(L.getMyCourses, asKid(kid))).body.data.courses;
const parentList = async (parent: string) => (await call(E.getMyEnrollments, asParent(parent))).body.data.enrollments;

test('the standard trial is 7 days', () => {
  assert.equal(trial.TRIAL_DAYS, 7);
});

test('starting the trial makes the enrollment active for 7 days, with no payment, and the child can open the course', async () => {
  const w = await world();
  assert.equal((await kidCourses(w.kid)).length, 0); // unpaid: nothing to open yet
  const r = await start(w, w.enrollment);
  assert.equal(r.error, null);
  assert.equal(r.status, 201);
  assert.equal(r.body.data.trial.duration_days, 7);
  const row = await enrRow(w.enrollment);
  assert.equal(row.status, 'active');
  const days = (new Date(row.trial_ends_at).getTime() - Date.now()) / 86400000;
  assert.ok(days > 6.99 && days <= 7.001, `ends in ${days} days`);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM payments WHERE enrollment_id = $1', [w.enrollment])).rows[0].n, 0); // nobody paid

  // the child can see and open it
  assert.equal((await kidCourses(w.kid)).length, 1);
  const content = await call(L.getCourseContent, asKid(w.kid, { params: { enrollmentId: w.enrollment } }));
  assert.equal(content.error, null);
  const lesson = await call(L.getLesson, asKid(w.kid, { params: { enrollmentId: w.enrollment, lessonId: w.lesson } }));
  assert.equal(lesson.error, null);

  // the parent sees it as a trial with the days left
  const mine = (await parentList(w.parent)).find((e: any) => e.id === w.enrollment);
  assert.equal(mine.payment_status, 'trial');
  assert.equal(mine.trial_days_left, 7);
  assert.equal(mine.trial_ended, false);
});

test('access stops at the exact moment the trial ends, even before the clean-up job has run', async () => {
  const w = await world();
  await start(w, w.enrollment);
  await db.query(`UPDATE enrollments SET trial_ends_at = now() - interval '1 minute' WHERE id = $1`, [w.enrollment]);
  assert.equal((await enrRow(w.enrollment)).status, 'active'); // the job has not run
  assert.equal((await kidCourses(w.kid)).length, 0);
  const content = await call(L.getCourseContent, asKid(w.kid, { params: { enrollmentId: w.enrollment } }));
  assert.ok(content.error, 'course content is closed');
  const lesson = await call(L.getLesson, asKid(w.kid, { params: { enrollmentId: w.enrollment, lessonId: w.lesson } }));
  assert.ok(lesson.error, 'the lesson is closed');
});

test('the clean-up job puts an ended trial back to unpaid and marks it expired; the parent is told it ended', async () => {
  const w = await world();
  await start(w, w.enrollment);
  await db.query(`UPDATE enrollments SET trial_ends_at = now() - interval '1 minute' WHERE id = $1`, [w.enrollment]);
  await db.query(`UPDATE trial_access SET expires_at = now() - interval '1 minute' WHERE kid_id = $1`, [w.kid]);
  assert.ok((await trial.expireTrials()) >= 1);
  assert.equal((await enrRow(w.enrollment)).status, 'pending');
  assert.equal((await db.query('SELECT status FROM trial_access WHERE kid_id = $1', [w.kid])).rows[0].status, 'expired');
  const mine = (await parentList(w.parent)).find((e: any) => e.id === w.enrollment);
  assert.equal(mine.payment_status, 'unpaid');
  assert.equal(mine.trial_ended, true);
  assert.equal(mine.trial_days_left, null);
  // running it again changes nothing
  const again = await trial.expireTrials();
  assert.equal((await enrRow(w.enrollment)).status, 'pending');
  assert.equal(typeof again, 'number');
});

test('a trial that is still running is not touched by the clean-up job', async () => {
  const w = await world();
  await start(w, w.enrollment);
  await trial.expireTrials();
  assert.equal((await enrRow(w.enrollment)).status, 'active');
  assert.equal((await kidCourses(w.kid)).length, 1);
});

test('paying turns the trial into a normal paid enrollment, before or after the trial ended', async () => {
  for (const ended of [false, true]) {
    const w = await world();
    await start(w, w.enrollment);
    if (ended) {
      await db.query(`UPDATE enrollments SET trial_ends_at = now() - interval '1 minute' WHERE id = $1`, [w.enrollment]);
      await db.query(`UPDATE trial_access SET expires_at = now() - interval '1 minute' WHERE kid_id = $1`, [w.kid]);
      await trial.expireTrials();
    }
    const p = (await db.query(
      `INSERT INTO payments (enrollment_id,kid_id,parent_id,amount,method,reference,receipt_number,status,source,date)
       VALUES ($1,$2,$3,4000,'Paystack',$4,$5,'pending','paystack',now()) RETURNING id`,
      [w.enrollment, w.kid, w.parent, `REF${n}${ended}`, `RCP-T-${n}-${ended}`]
    )).rows[0].id;
    assert.equal(await svc.finalizeSuccess(p, { receipt: null, allowedFrom: ['pending'] }), true);
    const row = await enrRow(w.enrollment);
    assert.equal(row.status, 'active');
    assert.equal(row.trial_ends_at, null); // no longer a trial: it can never run out
    assert.equal(row.payment_status, 'paid');
    assert.equal((await db.query('SELECT status FROM trial_access WHERE kid_id = $1', [w.kid])).rows[0].status, 'converted');
    assert.equal((await kidCourses(w.kid)).length, 1);
    await trial.expireTrials();
    assert.equal((await kidCourses(w.kid)).length, 1); // the clean-up job leaves a paid enrollment alone
    const mine = (await parentList(w.parent)).find((e: any) => e.id === w.enrollment);
    assert.notEqual(mine.payment_status, 'trial');
  }
});

test('one free trial per child, ever: a second course (or trying again) is refused', async () => {
  const w = await world();
  await start(w, w.enrollment);
  const course2 = (await db.query(`INSERT INTO courses (title, price) VALUES ('Second', 4000) RETURNING id`)).rows[0].id;
  const second = await w.enroll(course2);
  const refused = await start(w, second);
  assert.equal(refused.error?.statusCode, 400);
  assert.match(refused.error.message, /already used/);
  assert.equal((await enrRow(second)).status, 'pending');
  // not even after the first trial ended
  await db.query(`UPDATE enrollments SET trial_ends_at = now() - interval '1 minute' WHERE id = $1`, [w.enrollment]);
  await trial.expireTrials();
  assert.equal((await start(w, second)).error?.statusCode, 400);
});

test('a second tap starts nothing, and the database itself refuses a second trial for the same child', async () => {
  const w = await world();
  assert.equal((await start(w, w.enrollment)).error, null);
  const again = await start(w, w.enrollment);
  assert.equal(again.error?.statusCode, 409); // already active: nothing changes
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM trial_access WHERE kid_id = $1', [w.kid])).rows[0].n, 1);
  // the last line of defence, for two requests at the very same moment: one trial row per child, enforced by an index
  await assert.rejects(
    () => db.query(`INSERT INTO trial_access (kid_id, course_id, expires_at, status) VALUES ($1, $2, now() + interval '7 days', 'active')`, [w.kid, w.course]),
    (e: any) => e?.code === '23505'
  );
});

test('who can start a trial: only the owner, only for an unpaid enrollment, only where the course allows it', async () => {
  const w = await world();
  const stranger = await world();
  assert.equal((await start(stranger, w.enrollment)).error?.statusCode, 404); // someone else's enrollment
  assert.equal((await enrRow(w.enrollment)).status, 'pending');

  await db.query(`UPDATE enrollments SET status = 'cancelled' WHERE id = $1`, [w.enrollment]);
  assert.equal((await start(w, w.enrollment)).error?.statusCode, 400); // cancelled
  await db.query(`UPDATE enrollments SET status = 'active' WHERE id = $1`, [w.enrollment]);
  assert.equal((await start(w, w.enrollment)).error?.statusCode, 409); // already active (paid)

  const off = await world({ trialAvailable: false });
  const refused = await start(off, off.enrollment);
  assert.equal(refused.error?.statusCode, 400);
  assert.match(refused.error.message, /not available/);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM trial_access WHERE kid_id = $1', [off.kid])).rows[0].n, 0);
});

test('the trial length follows the course when it is sensible, and is 7 days otherwise', async () => {
  const short = await world({ trialDays: 3 });
  assert.equal((await start(short, short.enrollment)).body.data.trial.duration_days, 3);
  for (const odd of [0, 99, null]) {
    const w = await world({ trialDays: odd as any });
    assert.equal((await start(w, w.enrollment)).body.data.trial.duration_days, 7, String(odd));
  }
});

test('eligibility: which children can still start a trial', async () => {
  const w = await world();
  const other = (await db.query(`INSERT INTO kids (parent_id,name,age) VALUES ($1,'Second',6) RETURNING id`, [w.parent])).rows[0].id;
  let r = await call(T.getTrialEligibility, asParent(w.parent));
  assert.equal(r.body.data.trial_days, 7);
  assert.deepEqual(r.body.data.kids.map((k: any) => k.used), [false, false]);
  await start(w, w.enrollment);
  r = await call(T.getTrialEligibility, asParent(w.parent));
  const byKid = Object.fromEntries(r.body.data.kids.map((k: any) => [k.kid_id, k.used]));
  assert.equal(byKid[w.kid], true);
  assert.equal(byKid[other], false);
});

test('the migration gives every course a 7-day trial by default', async () => {
  const id = (await db.query(`INSERT INTO courses (title, price) VALUES ('Default', 100) RETURNING id`)).rows[0].id;
  assert.equal((await db.query('SELECT trial_duration_days FROM courses WHERE id = $1', [id])).rows[0].trial_duration_days, 7);
});

test('the server refuses to start when the free-trial migration has not been applied, and says what to run', async () => {
  const { assertDatabaseIsMigrated } = require('../src/utils/schemaCheck');
  await assert.doesNotReject(() => assertDatabaseIsMigrated()); // migrated: fine
  await db.query('ALTER TABLE enrollments RENAME COLUMN trial_ends_at TO trial_ends_at_old');
  try {
    await assert.rejects(() => assertDatabaseIsMigrated(), /007_free_trial[\s\S]*migrate\.js --main/);
  } finally {
    await db.query('ALTER TABLE enrollments RENAME COLUMN trial_ends_at_old TO trial_ends_at');
  }
});
