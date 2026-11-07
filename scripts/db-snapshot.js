/**
 * READ-ONLY database snapshot.
 *  - writes a schema file (CREATE TABLE ... reconstructed from the catalog)
 *  - optionally writes a JSON data backup (--data)
 * Never modifies the database: runs inside a READ ONLY transaction.
 *
 * Usage: node scripts/db-snapshot.js --schema schema/schema.sql
 *        node scripts/db-snapshot.js --data ../backups/akili-YYYYMMDD.json
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query('BEGIN READ ONLY');
  const q = async (s, p) => (await c.query(s, p)).rows;

  const tables = (await q(`SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1`)).map((r) => r.table_name);

  const schemaOut = arg('--schema');
  if (schemaOut) {
    let sql = `-- Reconstructed from the live database catalog (read-only).\n-- Generated ${new Date().toISOString()}\n\n`;
    const enums = await q(`SELECT t.typname, string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder) AS labels
      FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public' GROUP BY 1`);
    enums.forEach((e) => { sql += `CREATE TYPE ${e.typname} AS ENUM (${e.labels});\n`; });
    if (enums.length) sql += '\n';
    const fks = [];
    const seqs = await q("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S' ORDER BY 1");
    seqs.forEach((x) => { sql += 'CREATE SEQUENCE IF NOT EXISTS ' + x.relname + ';\n'; });
    if (seqs.length) sql += '\n';
    sql += 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";\nCREATE EXTENSION IF NOT EXISTS pgcrypto;\n\n';
    for (const t of tables) {
      const cols = await q(`SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull,
          pg_get_expr(d.adbin, d.adrelid) AS def
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=('public.'||quote_ident($1))::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [t]);
      const cons = await q(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid=('public.'||quote_ident($1))::regclass AND contype <> 'f' ORDER BY conname`, [t]);
      fks.push(...(await q(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid=('public.'||quote_ident($1))::regclass AND contype = 'f' ORDER BY conname`, [t])).map((x) => ({ t, ...x })));
      const lines = cols.map((x) => `  ${x.attname} ${x.type}${x.def ? ' DEFAULT ' + x.def : ''}${x.attnotnull ? ' NOT NULL' : ''}`)
        .concat(cons.map((x) => `  CONSTRAINT ${x.conname} ${x.def}`));
      sql += `CREATE TABLE IF NOT EXISTS ${t} (\n${lines.join(',\n')}\n);\n`;
      const idx = await q(`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1
        AND indexname NOT IN (SELECT conname FROM pg_constraint WHERE conrelid=('public.'||quote_ident($1))::regclass)`, [t]);
      idx.forEach((i) => { sql += i.indexdef.replace('CREATE INDEX', 'CREATE INDEX IF NOT EXISTS').replace('CREATE UNIQUE INDEX', 'CREATE UNIQUE INDEX IF NOT EXISTS') + ';\n'; });
      sql += '\n';
    }
    sql += '-- Foreign keys are added last so table order does not matter.\n';
    fks.forEach((f) => { sql += 'ALTER TABLE ' + f.t + ' ADD CONSTRAINT ' + f.conname + ' ' + f.def + ';\n'; });
    fs.mkdirSync(path.dirname(schemaOut), { recursive: true });
    fs.writeFileSync(schemaOut, sql);
    console.log('schema ->', schemaOut, `(${tables.length} tables)`);
  }

  const dataOut = arg('--data');
  if (dataOut) {
    const out = {};
    for (const t of tables) { out[t] = await q(`SELECT * FROM "${t}"`); console.log(t, out[t].length, 'rows'); }
    fs.mkdirSync(path.dirname(dataOut), { recursive: true });
    fs.writeFileSync(dataOut, JSON.stringify(out));
    console.log('data ->', dataOut);
  }
  await c.query('ROLLBACK');
  await c.end();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
