/**
 * Boots an in-process PostgreSQL (pglite) from schema/schema.sql + every file in
 * migrations/, and swaps it in for config/db. Never touches a real database.
 */
import fs from 'node:fs';
import path from 'node:path';

const fakeModule = (file: string, exports: any) => {
  const id = require.resolve(file);
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] } as any;
};
export { fakeModule };

export const bootDb = async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { uuid_ossp } = await import('@electric-sql/pglite/contrib/uuid_ossp');
  const db = new PGlite({ extensions: { uuid_ossp } });

  const root = path.join(__dirname, '../..');
  await db.exec(
    fs.readFileSync(path.join(root, 'schema/schema.sql'), 'utf8').replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/, '')
  );
  for (const f of fs.readdirSync(path.join(root, 'migrations')).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'));
  }

  // pglite runs one statement at a time, so transactions from different "clients" must not interleave.
  let chain: Promise<unknown> = Promise.resolve();
  const run = (sql: string, params?: any[]) => {
    const p = chain.then(async () => {
      const r = await db.query(sql, params);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    });
    chain = p.catch(() => undefined);
    return p as Promise<{ rows: any[]; rowCount: number }>;
  };
  // A checked-out client holds the "lock" from BEGIN until COMMIT/ROLLBACK.
  const connect = async () => {
    let release!: () => void;
    let held = false;
    const gate = new Promise<void>((r) => (release = r));
    const client = {
      query: async (sql: string, params?: any[]) => {
        if (/^\s*BEGIN/i.test(sql) && !held) {
          held = true;
          const prev = chain;
          chain = prev.then(() => gate);
          await prev;
          const r = await db.query(sql, params);
          return { rows: r.rows, rowCount: 0 };
        }
        if (held) {
          const r = await db.query(sql, params);
          if (/^\s*(COMMIT|ROLLBACK)/i.test(sql)) { held = false; release(); }
          return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
        }
        return run(sql, params);
      },
      release() { if (held) { held = false; release(); } },
    };
    return client;
  };
  const pool = { query: run, connect, on() {} };
  fakeModule('../../src/config/db', { __esModule: true, default: pool, query: run });
  return { db, pool, query: run };
};
