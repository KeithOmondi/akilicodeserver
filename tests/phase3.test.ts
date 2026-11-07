/** PIN reset, opt-in leaderboard, consent re-acceptance, admin receipts. Real app, in-process Postgres. */
import './setup';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import bcrypt from 'bcryptjs';
import { bootDb } from './helpers/pg';

let server: http.Server;
let base = '';
let q: (sql: string, p?: any[]) => Promise<{ rows: any[]; rowCount: number }>;
before(async () => {
  q = (await bootDb()).query;
  server = http.createServer(require('../src/app').default).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server.close(); setTimeout(() => process.exit(0), 100).unref(); });

let n = 0;
const call = async (method: string, path: string, body?: unknown, o: { token?: string; gate?: string; cookie?: string } = {}) => {
  const headers: Record<string, string> = { 'x-forwarded-for': `10.2.${Math.floor(++n / 250)}.${n % 250}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.gate) headers['x-parent-gate'] = o.gate;
  if (o.cookie) headers.cookie = o.cookie;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any, cookies: res.headers.getSetCookie().map((c) => c.split(';')[0]) };
};
const hash = bcrypt.hashSync('Passw0rd1', 4);
const parent = async (email: string, phone: string) => {
  const id = (await q(`INSERT INTO users (name,email,phone,password,role,is_verified) VALUES ('P','${email}','${phone}',$1,'parent',true) RETURNING id`, [hash])).rows[0].id;
  const login = await call('POST', '/api/v1/auth/login', { email, password: 'Passw0rd1' });
  const gate = await call('POST', '/api/v1/auth/parent-gate', { password: 'Passw0rd1' }, { token: login.json.accessToken });
  return { id, token: login.json.accessToken as string, gate: gate.json.data.gateToken as string };
};
const kid = async (parentId: string, name: string, pin: string, points = 0) =>
  (await q(`INSERT INTO kids (parent_id,name,age,avatar,pin_hash,total_points,streak_days) VALUES ($1,$2,9,'fox',$3,$4,2) RETURNING id`, [parentId, name, bcrypt.hashSync(pin, 4), points])).rows[0].id as string;

test('forced PIN reset: child sees a friendly message; the parent sets a new PIN; it works again', async () => {
  const p = await parent('a@x.co', '0711000001');
  const k = await kid(p.id, 'Zuri', '4321');
  const link = await call('POST', '/api/v1/kids/device/link', undefined, { token: p.token, gate: p.gate });
  const cookie = link.cookies.find((c) => c.startsWith('akili_device='))!;

  // what scripts/force-pin-reset.js does
  await q(`UPDATE kids SET pin_hash = NULL, pin_failed_attempts = 0, pin_locked_until = NULL, pin_reset_required = true WHERE id = $1`, [k]);

  const list = await call('GET', '/api/v1/kids/picker', undefined, { cookie });
  assert.equal(list.json.data.kids[0].needs_new_pin, true);
  const tryLogin = await call('POST', '/api/v1/kids/picker/login', { kid_id: k, pin: '4321' }, { cookie });
  assert.equal(tryLogin.status, 403);
  assert.equal(tryLogin.json.code, 'PIN_RESET_REQUIRED');
  // the any-device login does not reveal the reset
  const generic = await call('POST', '/api/v1/kids/login', { username: 'nobody', pin: '4321' });
  assert.equal(generic.status, 401);

  const mine = await call('GET', '/api/v1/kids/my-kids', undefined, { token: p.token });
  assert.equal(mine.json.data.kids[0].pin_reset_required, true);
  assert.equal((await call('PUT', `/api/v1/kids/${k}/pin`, { pin: '2468' }, { token: p.token, gate: p.gate })).status, 200);
  assert.equal((await call('GET', '/api/v1/kids/my-kids', undefined, { token: p.token })).json.data.kids[0].pin_reset_required, false);
  assert.equal((await call('POST', '/api/v1/kids/picker/login', { kid_id: k, pin: '4321' }, { cookie })).status, 401); // old PIN is dead
  assert.equal((await call('POST', '/api/v1/kids/picker/login', { kid_id: k, pin: '2468' }, { cookie })).status, 200);
});

test('leaderboard is opt-in, nickname-only, and every child gets a personal best', async () => {
  const a = await parent('b@x.co', '0711000002');
  const b = await parent('c@x.co', '0711000003');
  const ka = await kid(a.id, 'Amani', '1111', 300);
  const kb = await kid(b.id, 'Baraka', '2222', 500);
  const login = async (k: string, pin: string, par: any) => {
    const link = await call('POST', '/api/v1/kids/device/link', undefined, { token: par.token, gate: par.gate });
    const cookie = link.cookies.find((c) => c.startsWith('akili_device='))!;
    return (await call('POST', '/api/v1/kids/picker/login', { kid_id: k, pin }, { cookie })).json.accessToken as string;
  };
  const ta = await login(ka, '1111', a);
  const tb = await login(kb, '2222', b);

  const off = await call('GET', '/api/v1/kids/leaderboard', undefined, { token: ta });
  assert.equal(off.status, 200);
  assert.equal(off.json.data.opted_in, false);
  assert.deepEqual(off.json.data.leaderboard, []); // sees nobody
  assert.equal(off.json.data.personal_best.total_points, 300);
  assert.equal(JSON.stringify(off.json).includes('Baraka'), false);

  // the toggle needs the gate and belongs to the child's own parent
  assert.equal((await call('PUT', `/api/v1/kids/${ka}/leaderboard`, { opt_in: true }, { token: a.token })).status, 403);
  assert.equal((await call('PUT', `/api/v1/kids/${ka}/leaderboard`, { opt_in: true }, { token: b.token, gate: b.gate })).status, 404);
  assert.equal((await call('PUT', `/api/v1/kids/${ka}/leaderboard`, { opt_in: true }, { token: a.token, gate: a.gate })).status, 200);

  // only one is opted in: that child sees only themselves; the other child (not opted in) sees nobody
  const solo = await call('GET', '/api/v1/kids/leaderboard', undefined, { token: ta });
  assert.equal(solo.json.data.leaderboard.length, 1);
  assert.equal((await call('GET', '/api/v1/kids/leaderboard', undefined, { token: tb })).json.data.leaderboard.length, 0);

  await call('PUT', `/api/v1/kids/${kb}/leaderboard`, { opt_in: true }, { token: b.token, gate: b.gate });
  const both = await call('GET', '/api/v1/learning/leaderboard', undefined, { token: ta });
  const rows = both.json.data.leaderboard;
  assert.deepEqual(rows.map((r: any) => [r.rank, r.name, r.is_me]), [[1, 'Baraka', false], [2, 'Amani', true]]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['avatar', 'is_me', 'name', 'rank', 'total_points']); // no ids, no parents, no ages
});

test('personal best compares this week with the best week', async () => {
  const p = await parent('d@x.co', '0711000004');
  const k = await kid(p.id, 'Neema', '3333', 90);
  const link = await call('POST', '/api/v1/kids/device/link', undefined, { token: p.token, gate: p.gate });
  const t = (await call('POST', '/api/v1/kids/picker/login', { kid_id: k, pin: '3333' }, { cookie: link.cookies[0] })).json.accessToken;
  const course = (await q(`INSERT INTO courses (title, price) VALUES ('C', 1) RETURNING id`)).rows[0].id;
  const mod = (await q(`INSERT INTO modules (course_id, title) VALUES ($1,'M') RETURNING id`, [course])).rows[0].id;
  const enr = (await q(`INSERT INTO enrollments (kid_id,parent_id,course_id,course_name,fee_amount,billing_cycle,status) VALUES ($1,$2,$3,'C',1,'monthly','active') RETURNING id`, [k, p.id, course])).rows[0].id;
  const lesson = async (days: number, pts: number) => {
    const l = (await q(`INSERT INTO lessons (module_id, title) VALUES ($1,'L') RETURNING id`, [mod])).rows[0].id;
    await q(`INSERT INTO kid_progress (kid_id, lesson_id, enrollment_id, completed, points_earned, completed_at) VALUES ($1,$2,$3,true,$4, now() - ($5 || ' days')::interval)`, [k, l, enr, pts, String(days)]);
  };
  await lesson(21, 70);
  await lesson(0, 20);
  const r = await call('GET', '/api/v1/kids/leaderboard', undefined, { token: t });
  assert.equal(r.json.data.personal_best.this_week_points, 20);
  assert.equal(r.json.data.personal_best.best_week_points, 70);
  assert.equal(r.json.data.personal_best.is_best_week, false);
});

test('consent wording is versioned: older versions must be re-accepted, and both versions are on record', async () => {
  const p = await parent('e@x.co', '0711000005');
  const doc = (await call('GET', '/api/v1/kids/consent-document')).json.data;
  const consent = { accepted: true, is_guardian: true, version: doc.version };
  const made = await call('POST', '/api/v1/kids/register', { name: 'Imani', age: 8, consent }, { token: p.token });
  assert.equal(made.status, 201);
  const kidId = made.json.data.kid.id;
  assert.equal((await call('GET', '/api/v1/kids/my-kids', undefined, { token: p.token })).json.data.kids[0].needs_consent, false);

  // the wording changes later: pretend the stored consent was for an older version
  await q(`UPDATE parental_consents SET policy_version = '2026-01-old' WHERE kid_id = $1`, [kidId]);
  const mine = await call('GET', '/api/v1/kids/my-kids', undefined, { token: p.token });
  assert.equal(mine.json.data.kids[0].needs_consent, true);
  assert.equal(mine.json.data.kids[0].consent_version, '2026-01-old');

  assert.equal((await call('POST', `/api/v1/kids/${kidId}/consent`, { consent: { ...consent, version: 'wrong' } }, { token: p.token })).status, 409);
  assert.equal((await call('POST', `/api/v1/kids/${kidId}/consent`, { consent }, { token: p.token })).status, 200);
  assert.equal((await call('GET', '/api/v1/kids/my-kids', undefined, { token: p.token })).json.data.kids[0].needs_consent, false);
  const versions = (await q(`SELECT policy_version FROM parental_consents WHERE kid_id = $1 ORDER BY accepted_at`, [kidId])).rows.map((r) => r.policy_version);
  assert.deepEqual(versions, ['2026-01-old', doc.version]);
});

test('admins can open any receipt and any child’s payments; parents only their own', async () => {
  const p = await parent('f@x.co', '0711000006');
  const other = await parent('g@x.co', '0711000007');
  await q(`INSERT INTO users (name,email,phone,password,role,is_verified) VALUES ('Boss','boss2@x.co','0733000002',$1,'admin',true)`, [hash]);
  const admin = (await call('POST', '/api/v1/auth/login', { email: 'boss2@x.co', password: 'Passw0rd1' })).json.accessToken;
  const k = await kid(p.id, 'Zawadi', '5555');
  const course = (await q(`INSERT INTO courses (title, price) VALUES ('C2', 1) RETURNING id`)).rows[0].id;
  const enr = (await q(`INSERT INTO enrollments (kid_id,parent_id,course_id,course_name,fee_amount,billing_cycle,status) VALUES ($1,$2,$3,'C2',1,'monthly','active') RETURNING id`, [k, p.id, course])).rows[0].id;
  const pay = (await q(`INSERT INTO payments (enrollment_id,kid_id,parent_id,amount,method,receipt_number,status) VALUES ($1,$2,$3,1,'M-Pesa','RCP-ADM-1','completed') RETURNING id`, [enr, k, p.id])).rows[0].id;

  assert.equal((await call('GET', `/api/v1/payments/${pay}/receipt`, undefined, { token: admin })).status, 200);
  assert.equal((await call('GET', `/api/v1/payments/${pay}/receipt`, undefined, { token: p.token })).status, 200);
  assert.equal((await call('GET', `/api/v1/payments/${pay}/receipt`, undefined, { token: other.token })).status, 404);
  const list = await call('GET', `/api/v1/payments/kid/${k}`, undefined, { token: admin });
  assert.equal(list.json.results, 1);
});

test('admins can change a course price; parents cannot; nonsense prices are refused', async () => {
  const p = await parent('h@x.co', '0711000008');
  await q(`INSERT INTO users (name,email,phone,password,role,is_verified) VALUES ('Boss','boss3@x.co','0733000003',$1,'admin',true)`, [hash]);
  const admin = (await call('POST', '/api/v1/auth/login', { email: 'boss3@x.co', password: 'Passw0rd1' })).json.accessToken;
  const id = (await q(`INSERT INTO courses (title, price) VALUES ('Scratch', 3000) RETURNING id`)).rows[0].id;

  assert.equal((await call('PATCH', `/api/v1/courses/${id}`, { price: 1 }, { token: p.token })).status, 403);
  assert.equal((await call('PATCH', `/api/v1/courses/${id}`, { price: -5 }, { token: admin })).status, 400);
  assert.equal((await call('PATCH', `/api/v1/courses/${id}`, { price: 'free' }, { token: admin })).status, 400);
  assert.equal((await call('PATCH', `/api/v1/courses/${id}`, {}, { token: admin })).status, 400);
  const ok = await call('PATCH', `/api/v1/courses/${id}`, { price: 3500, 'title = (SELECT 1); --': 'x' }, { token: admin });
  assert.equal(ok.status, 200);
  assert.equal(Number(ok.json.data.course.price), 3500);
  assert.equal(ok.json.data.course.title, 'Scratch'); // an injected key did nothing
});
