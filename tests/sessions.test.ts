/** Sessions: a child's session renews itself, and parents and children never share a cookie. */
import './setup';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';

let db: any;
let K: typeof import('../src/controllers/kidAccountController');
let T: typeof import('../src/utils/sendToken');

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
  await db.exec(fs.readFileSync(path.join(root, 'migrations/003_pin_reset_and_leaderboard.sql'), 'utf8'));
  const run = async (sql: string, params?: any[]) => {
    const r = await db.query(sql, params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  fakeModule('../src/config/db', { __esModule: true, default: { query: run, connect: async () => ({ query: run, release() {} }), on() {} }, query: run });
  T = require('../src/utils/sendToken');
  K = require('../src/controllers/kidAccountController');
});

const makeRes = () => {
  const cookies: { name: string; value: string; opts: any }[] = [];
  const cleared: { name: string; opts: any }[] = [];
  let body: any; let status = 200;
  const res: any = {
    cookie(name: string, value: string, opts: any) { cookies.push({ name, value, opts }); return res; },
    clearCookie(name: string, opts: any) { cleared.push({ name, opts }); return res; },
    status(c: number) { status = c; return res; },
    json(b: any) { body = b; return res; },
  };
  return { res, cookies, cleared, get body() { return body; }, get status() { return status; } };
};

const refreshWith = async (cookies: Record<string, string>) => {
  const r = makeRes();
  let error: any = null;
  await K.refreshKid({ cookies } as any, r.res, (e: any) => { error = e; });
  return { r, error };
};

let n = 0;
const seedKid = async (extra = '') => {
  n++;
  const parent = (await db.query(`INSERT INTO users (name,email,phone,password,is_verified) VALUES ('P',$1,$2,'x',true) RETURNING id`, [`s${n}@x.co`, `07${40000000 + n}`])).rows[0].id;
  const kid = (await db.query(`INSERT INTO kids (parent_id,name,age,username) VALUES ($1,'Kid',9,$2) RETURNING id, parent_id, name`, [parent, `kid${n}`])).rows[0];
  if (extra) await db.query(`UPDATE kids SET ${extra} WHERE id = $1`, [kid.id]);
  return { parent, kid };
};
const kidCookie = (kid: any, opts: any = { expiresIn: '24h' }) => jwt.sign({ id: kid.id, role: 'kid', name: kid.name, parent_id: kid.parent_id }, process.env.JWT_REFRESH_SECRET!, opts);

test('a child signing in gets their OWN cookie, scoped to the kid routes (never the parent cookie)', () => {
  const r = makeRes();
  T.sendToken({ id: 'k1', role: 'kid', name: 'Kid', parent_id: 'p1' }, 200, r.res, 'kid');
  assert.equal(r.cookies.length, 1);
  assert.equal(r.cookies[0].name, T.KID_COOKIE);
  assert.equal(r.cookies[0].opts.path, '/api/v1/kids');
  assert.equal(r.cookies[0].opts.httpOnly, true);
  assert.ok(r.body.accessToken);
});

test('a parent signing in still gets the normal refresh cookie', () => {
  const r = makeRes();
  T.sendToken({ id: 'u1', role: 'parent', name: 'Parent', email: 'a@b.co' }, 200, r.res);
  assert.equal(r.cookies[0].name, 'refreshToken');
  assert.notEqual(r.cookies[0].opts.path, '/api/v1/kids');
});

test('a valid child cookie renews the session and slides it forward', async () => {
  const { kid } = await seedKid();
  const { r, error } = await refreshWith({ [T.KID_COOKIE]: kidCookie(kid) });
  assert.equal(error, null);
  assert.ok(r.body.accessToken);
  assert.equal(r.body.data.kid.id, kid.id);
  assert.equal(r.cookies[0].name, T.KID_COOKIE); // a fresh 24h cookie
});

test('no cookie, a parent cookie, a forged cookie or an expired cookie all say 401', async () => {
  const { kid } = await seedKid();
  assert.equal((await refreshWith({})).error.statusCode, 401);
  assert.equal((await refreshWith({ refreshToken: kidCookie(kid) })).error.statusCode, 401); // wrong cookie name
  assert.equal((await refreshWith({ [T.KID_COOKIE]: jwt.sign({ id: kid.id, role: 'kid' }, 'not-the-secret-not-the-secret-123456') })).error.statusCode, 401);
  assert.equal((await refreshWith({ [T.KID_COOKIE]: kidCookie(kid, { expiresIn: -10 }) })).error.statusCode, 401);
  const parentToken = jwt.sign({ id: kid.parent_id, role: 'parent' }, process.env.JWT_REFRESH_SECRET!, { expiresIn: '1h' });
  assert.equal((await refreshWith({ [T.KID_COOKIE]: parentToken })).error.statusCode, 401); // a parent token cannot become a child session
});

test('a deleted child, or one whose PIN a parent just reset, cannot renew (they must sign in again)', async () => {
  const a = await seedKid();
  await db.query('DELETE FROM kids WHERE id = $1', [a.kid.id]);
  assert.equal((await refreshWith({ [T.KID_COOKIE]: kidCookie(a.kid) })).error.statusCode, 401);

  const b = await seedKid('pin_reset_required = true');
  assert.equal((await refreshWith({ [T.KID_COOKIE]: kidCookie(b.kid) })).error.statusCode, 401);
});

test('logging out clears the child cookie on its own path', () => {
  const r = makeRes();
  K.logoutKid({} as any, r.res);
  assert.equal(r.cleared[0].name, T.KID_COOKIE);
  assert.equal(r.cleared[0].opts.path, '/api/v1/kids');
});
