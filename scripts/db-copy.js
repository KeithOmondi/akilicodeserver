/**
 * Copy a whole database (structure + data) from one PostgreSQL server to another EMPTY one.
 *
 *   node scripts/db-copy.js            DRY RUN: builds everything on the target inside a transaction,
 *                                       checks it, then ROLLS BACK. Nothing is kept.
 *   node scripts/db-copy.js --apply    does the same and COMMITS.
 *
 * SOURCE = DATABASE_URL      (only ever read, inside a READ ONLY transaction)
 * TARGET = DATABASE_URL_NEW  (must have no tables in schema "public"; otherwise the script stops)
 *
 * Rows travel as JSON text and are rebuilt with the column types of the target tables, so
 * timestamps, numerics and arrays are copied exactly (no time-zone or rounding changes).
 * After loading, every table is compared with an md5 fingerprint of its rows on both sides.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Client } = require('pg');
const schemaDump = require('./lib/schema-dump');

const apply = process.argv.includes('--apply');
const hostOf = (u) => (u || '').replace(/^.*@/, '').replace(/[/?].*$/, '');
const connect = async (url) => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  return c;
};

(async () => {
  const srcUrl = process.env.DATABASE_URL;
  const dstUrl = process.env.DATABASE_URL_NEW;
  if (!srcUrl || !dstUrl) throw new Error('Set DATABASE_URL (source) and DATABASE_URL_NEW (target) in server/.env');
  if (hostOf(srcUrl) === hostOf(dstUrl)) throw new Error('Source and target are the same server. Refusing.');
  console.log(`source: ${hostOf(srcUrl)}  (read-only)`);
  console.log(`target: ${hostOf(dstUrl)}  (${apply ? 'WILL COMMIT' : 'dry run: will roll back'})\n`);

  const src = await connect(srcUrl);
  const dst = await connect(dstUrl);
  try {
    await src.query('BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ'); // one consistent snapshot of the source
    const sq = async (s, p) => (await src.query(s, p)).rows;
    const dq = async (s, p) => (await dst.query(s, p)).rows;

    const existing = await dq(`SELECT count(*)::int c FROM information_schema.tables WHERE table_schema='public'`);
    if (existing[0].c > 0) throw new Error(`The target already has ${existing[0].c} table(s). Refusing to touch a database that is not empty.`);

    const { pre, post, tables, sequences } = await schemaDump(sq);
    console.log(`structure: ${tables.length} tables, ${sequences.length} sequence(s)`);

    await dst.query('BEGIN');
    await dst.query(pre);

    let total = 0;
    for (const t of tables) {
      const rows = await sq(`SELECT to_jsonb(t)::text AS j FROM "${t}" t`);
      for (const r of rows) {
        await dst.query(`INSERT INTO "${t}" SELECT * FROM jsonb_populate_record(NULL::"${t}", $1::jsonb)`, [r.j]);
      }
      total += rows.length;
      console.log(`  ${t.padEnd(22)} ${String(rows.length).padStart(5)} rows`);
    }

    for (const s of sequences) {
      const v = (await sq(`SELECT last_value, is_called FROM "${s}"`))[0];
      await dst.query(`SELECT setval('"${s}"', $1, $2)`, [v.last_value, v.is_called]);
    }

    await dst.query(post); // foreign keys, then triggers

    // verify: same rows on both sides
    console.log('\nverifying…');
    let bad = 0;
    for (const t of tables) {
      const fp = `SELECT count(*)::int AS n, COALESCE(md5(string_agg(to_jsonb(x)::text, '|' ORDER BY to_jsonb(x)::text)), '') AS h FROM "${t}" x`;
      const a = (await sq(fp))[0];
      const b = (await dq(fp))[0];
      const ok = a.n === b.n && a.h === b.h;
      if (!ok) { bad++; console.log(`  ✖ ${t}: source ${a.n} rows / target ${b.n} rows (fingerprints ${a.h === b.h ? 'match' : 'DIFFER'})`); }
    }
    const objs = await dq(`SELECT
      (SELECT count(*) FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT tg.tgisinternal)::int AS triggers,
      (SELECT count(*) FROM pg_constraint co JOIN pg_namespace n ON n.oid=co.connamespace WHERE n.nspname='public' AND co.contype='f')::int AS fks,
      (SELECT count(*) FROM pg_indexes WHERE schemaname='public')::int AS indexes`);
    const sobjs = await sq(`SELECT
      (SELECT count(*) FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT tg.tgisinternal)::int AS triggers,
      (SELECT count(*) FROM pg_constraint co JOIN pg_namespace n ON n.oid=co.connamespace WHERE n.nspname='public' AND co.contype='f')::int AS fks,
      (SELECT count(*) FROM pg_indexes WHERE schemaname='public')::int AS indexes`);
    for (const k of ['triggers', 'fks', 'indexes']) {
      const same = objs[0][k] === sobjs[0][k];
      if (!same) bad++;
      console.log(`  ${same ? '✔' : '✖'} ${k}: source ${sobjs[0][k]} / target ${objs[0][k]}`);
    }
    if (bad === 0) console.log(`  ✔ all ${tables.length} tables identical (${total} rows)`);

    if (bad > 0) throw new Error('Verification failed — rolling back, nothing was kept on the target.');
    if (apply) { await dst.query('COMMIT'); console.log('\nCOMMITTED. The target now holds a complete copy.'); }
    else { await dst.query('ROLLBACK'); console.log('\nDRY RUN OK — rolled back, the target is still empty. Run again with --apply to keep it.'); }
  } catch (e) {
    await dst.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await src.query('ROLLBACK').catch(() => undefined);
    await src.end(); await dst.end();
  }
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
