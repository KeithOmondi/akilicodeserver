/**
 * Removes EVERY course (with its modules, lessons, quiz questions and the children's progress in them),
 * to start the catalogue fresh. Payments and enrollments are KEPT: each enrollment is marked cancelled and
 * detached from the deleted course, so every payment record and receipt stays intact.
 *
 *   node scripts/reset-courses.js --main --backup ../backups/file.json            preview (writes nothing)
 *   node scripts/reset-courses.js --main --backup ../backups/file.json --apply    do it
 *
 * Safety:
 *  - it refuses to run unless --backup points at a file that exists (take one with scripts/db-snapshot.js --data)
 *  - everything happens in ONE transaction, and it rolls back if any payment or enrollment would be lost
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const dbTarget = require('./lib/db-target');

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };

const count = async (c, sql) => Number((await c.query(sql)).rows[0].n);
const snapshotCounts = async (c) => ({
  courses: await count(c, 'SELECT count(*) AS n FROM courses'),
  modules: await count(c, 'SELECT count(*) AS n FROM modules'),
  lessons: await count(c, 'SELECT count(*) AS n FROM lessons'),
  questions: await count(c, 'SELECT count(*) AS n FROM lesson_questions'),
  progress: await count(c, 'SELECT count(*) AS n FROM kid_progress'),
  enrollments: await count(c, 'SELECT count(*) AS n FROM enrollments'),
  payments: await count(c, 'SELECT count(*) AS n FROM payments'),
  paymentTotal: await count(c, "SELECT COALESCE(sum(amount),0) AS n FROM payments WHERE status = 'completed'"),
});

(async () => {
  const backup = arg('--backup');
  if (!backup || !fs.existsSync(path.resolve(process.cwd(), backup))) {
    console.error('Refusing to run: add --backup <file> pointing at a backup that exists.\nTake one first:  node scripts/db-snapshot.js --data ../backups/before-reset.json');
    process.exit(1);
  }
  const apply = process.argv.includes('--apply');
  const url = dbTarget();
  const c = new Client({ connectionString: url, ssl: /neon\.tech|sslmode=/.test(url) ? { rejectUnauthorized: true } : false });
  await c.connect();
  try {
    const before = await snapshotCounts(c);
    console.log('Backup found:', path.resolve(process.cwd(), backup));
    console.log('Now:', before);
    console.log(`${apply ? 'Deleting' : 'Would delete'}: ${before.courses} courses, ${before.modules} modules, ${before.lessons} lessons, ${before.questions} quiz questions and ${before.progress} progress rows.`);
    console.log(`${apply ? 'Keeping' : 'Would keep'}: all ${before.payments} payments (KES ${before.paymentTotal} completed) and all ${before.enrollments} enrollments (marked cancelled, no longer tied to a course).`);
    if (!apply) { console.log('\nPreview only. Add --apply to do it.'); return; }

    await c.query('BEGIN');
    try {
      await c.query("UPDATE enrollments SET status = 'cancelled', course_id = NULL WHERE course_id IS NOT NULL");
      await c.query('DELETE FROM calendar_events WHERE lesson_id IS NOT NULL'); // calendar items tied to lessons that are going away
      await c.query('DELETE FROM courses'); // cascades modules, lessons, questions, progress
      const after = await snapshotCounts(c);
      const problems = [];
      if (after.payments !== before.payments) problems.push(`payments ${before.payments} -> ${after.payments}`);
      if (after.paymentTotal !== before.paymentTotal) problems.push(`payment total ${before.paymentTotal} -> ${after.paymentTotal}`);
      if (after.enrollments !== before.enrollments) problems.push(`enrollments ${before.enrollments} -> ${after.enrollments}`);
      if (after.courses !== 0 || after.modules !== 0 || after.lessons !== 0) problems.push('courses were not all removed');
      if (problems.length) throw new Error('Rolled back, something would have been lost: ' + problems.join('; '));
      await c.query('COMMIT');
      console.log('Done:', after);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
