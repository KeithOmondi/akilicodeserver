/**
 * Force every child's PIN to be chosen again by their parent.
 *
 * Why: before the token fix, a child's login token contained the bcrypt hash of their PIN.
 * A 4-digit PIN can be recovered from its hash in seconds, so anyone who ever held such a
 * token (the child's own device, a proxy log) may know the PIN.
 *
 * What it does: removes the stored PIN hash (and clears any lockout). The child cannot log in
 * until a parent sets a new PIN from the dashboard ("Set login"); the login screen already says
 * "This account has no PIN set. Ask your parent to set it up." Nothing else changes: progress,
 * enrollments, points and usernames are untouched.
 *
 * SAFE BY DEFAULT: without --apply it only reports what it WOULD do (read-only transaction).
 *
 *   node scripts/force-pin-reset.js                 # dry run: lists the children affected
 *   node scripts/force-pin-reset.js --apply         # really do it (asks you to type RESET)
 *   node scripts/force-pin-reset.js --apply --kid <uuid>   # only one child
 *
 * It uses DATABASE_URL from .env — i.e. whatever database that points to. Check it first.
 * A list of the affected children is saved to pin-reset-<timestamp>.json (ids and nicknames only).
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const readline = require('readline');
const { Client } = require('pg');

const apply = process.argv.includes('--apply');
const kidArg = process.argv.includes('--kid') ? process.argv[process.argv.indexOf('--kid') + 1] : null;

const ask = (q) => new Promise((res) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (a) => { rl.close(); res(a); });
});

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const host = url.replace(/^.*@/, '').replace(/[/?].*$/, '');
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');

  const hasFlag = (await c.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'kids' AND column_name = 'pin_reset_required'`
  )).rows.length > 0;

  const params = kidArg ? [kidArg] : [];
  const kidFilter = kidArg ? ' AND k.id = $1' : '';
  const kids = (await c.query(
    'SELECT k.id, k.name, k.username, u.name AS parent FROM kids k JOIN users u ON u.id = k.parent_id WHERE k.pin_hash IS NOT NULL' + kidFilter + ' ORDER BY u.name, k.name', params
  )).rows;

  console.log(`Database host : ${host}`);
  console.log(`Children with a PIN that would be reset: ${kids.length}`);
  kids.forEach((k) => console.log(`  - ${k.name} (parent: ${k.parent}${k.username ? ', username ' + k.username : ''})`));

  if (!apply) {
    console.log('\nDRY RUN — nothing was changed. Add --apply to do it.');
    await c.query('ROLLBACK'); await c.end(); return;
  }
  if (kids.length === 0) { console.log('Nothing to do.'); await c.query('ROLLBACK'); await c.end(); return; }

  const answer = await ask(`\nThis removes the PIN of ${kids.length} child(ren) on ${host}. Type RESET to continue: `);
  if (answer.trim() !== 'RESET') { console.log('Cancelled.'); await c.query('ROLLBACK'); await c.end(); return; }

  const file = `pin-reset-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(file, JSON.stringify(kids.map(({ id, name }) => ({ id, name })), null, 2));

  const res = await c.query(
    'UPDATE kids SET pin_hash = NULL, pin_failed_attempts = 0, pin_locked_until = NULL' + (hasFlag ? ', pin_reset_required = true' : '') +
    ' WHERE pin_hash IS NOT NULL' + (kidArg ? ' AND id = $1' : ''), params
  );
  await c.query('COMMIT');
  await c.end();
  console.log(`Done: ${res.rowCount} PIN(s) removed. List saved to ${file}.`);
  console.log('Tell parents: open the dashboard, choose your child, and set a new PIN.');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
