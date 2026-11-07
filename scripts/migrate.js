/**
 * Minimal migration runner.
 *   node scripts/migrate.js --branch            apply pending migrations to the Neon BRANCH copy
 *   node scripts/migrate.js --branch --status   list applied / pending, change nothing
 *   node scripts/migrate.js --main              the REAL database (only when you mean it)
 *
 * Each file runs in its own transaction and is recorded in schema_migrations.
 * Take a backup first:  node scripts/db-snapshot.js --data ../backups/pre-migrate.json
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const dir = path.join(__dirname, '../migrations');

(async () => {
  const statusOnly = process.argv.includes('--status');
  const c = new Client({ connectionString: require('./lib/db-target')(), ssl: { rejectUnauthorized: false } });
  await c.connect();

  let applied = new Set();
  const exists = (await c.query(`SELECT to_regclass('public.schema_migrations') AS t`)).rows[0].t;
  if (exists) applied = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const pending = files.filter((f) => !applied.has(f));
  files.forEach((f) => console.log(applied.has(f) ? '  applied ' : '  PENDING ', f));

  if (statusOnly || pending.length === 0) {
    console.log(pending.length ? `${pending.length} pending` : 'Up to date.');
    return c.end();
  }

  await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);

  for (const f of pending) {
    process.stdout.write(`applying ${f} ... `);
    try {
      await c.query('BEGIN');
      await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
      await c.query('COMMIT');
      console.log('ok');
    } catch (e) {
      await c.query('ROLLBACK');
      console.log('FAILED');
      console.error(e.message);
      process.exitCode = 1;
      break;
    }
  }
  await c.end();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
