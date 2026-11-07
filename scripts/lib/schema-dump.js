/**
 * Rebuilds the SQL that creates a database's structure, read from the live catalog.
 * Returns { pre, post }:
 *   pre  = extensions, functions, sequences, tables, indexes      (run BEFORE loading data)
 *   post = foreign keys, triggers                                  (run AFTER loading data, so
 *          triggers do not fire during the load and FK order does not matter)
 * `q(sql, params)` must return rows.
 */
module.exports = async function schemaDump(q) {
  let pre = '';
  let post = '';

  // extensions
  const exts = (await q(`SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY 1`)).map((r) => r.extname);
  exts.forEach((e) => { pre += `CREATE EXTENSION IF NOT EXISTS "${e}";\n`; });
  if (exts.length) pre += '\n';

  // our own functions (not the ones that belong to extensions)
  const fns = await q(`
    SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
     ORDER BY p.proname`);
  fns.forEach((f) => { pre += f.def + ';\n\n'; });

  // enums
  const enums = await q(`SELECT t.typname, string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder) AS labels
    FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname='public' GROUP BY 1`);
  enums.forEach((e) => { pre += `CREATE TYPE ${e.typname} AS ENUM (${e.labels});\n`; });
  if (enums.length) pre += '\n';

  // sequences
  const seqs = await q(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='S' ORDER BY 1`);
  seqs.forEach((x) => { pre += `CREATE SEQUENCE IF NOT EXISTS ${x.relname};\n`; });
  if (seqs.length) pre += '\n';

  // tables
  const tables = (await q(`SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1`)).map((r) => r.table_name);
  for (const t of tables) {
    const cols = await q(`SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull,
        pg_get_expr(d.adbin, d.adrelid) AS def
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=('public.'||quote_ident($1))::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [t]);
    const cons = await q(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid=('public.'||quote_ident($1))::regclass AND contype <> 'f' ORDER BY conname`, [t]);
    const fks = await q(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid=('public.'||quote_ident($1))::regclass AND contype = 'f' ORDER BY conname`, [t]);
    const lines = cols.map((x) => `  ${x.attname} ${x.type}${x.def ? ' DEFAULT ' + x.def : ''}${x.attnotnull ? ' NOT NULL' : ''}`)
      .concat(cons.map((x) => `  CONSTRAINT ${x.conname} ${x.def}`));
    pre += `CREATE TABLE IF NOT EXISTS ${t} (\n${lines.join(',\n')}\n);\n`;
    const idx = await q(`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1
      AND indexname NOT IN (SELECT conname FROM pg_constraint WHERE conrelid=('public.'||quote_ident($1))::regclass)`, [t]);
    idx.forEach((i) => {
      pre += i.indexdef.replace('CREATE INDEX', 'CREATE INDEX IF NOT EXISTS').replace('CREATE UNIQUE INDEX', 'CREATE UNIQUE INDEX IF NOT EXISTS') + ';\n';
    });
    pre += '\n';
    fks.forEach((f) => { post += `ALTER TABLE ${t} ADD CONSTRAINT ${f.conname} ${f.def};\n`; });
  }

  // triggers
  const trgs = await q(`SELECT pg_get_triggerdef(t.oid) AS def FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname, t.tgname`);
  if (trgs.length) post += '\n';
  trgs.forEach((t) => { post += t.def + ';\n'; });

  return { pre, post, tables, sequences: seqs.map((s) => s.relname) };
};
