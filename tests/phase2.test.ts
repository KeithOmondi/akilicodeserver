/**
 * End-to-end tests for Phase 2 through the real Express app and a real SQL database
 * (in-process PostgreSQL built from schema.sql + migrations). No network, no live data.
 */
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
let outbox: { to: string; message: string }[];

before(async () => {
  const boot = await bootDb();
  q = boot.query;
  outbox = require('../src/services/sms/ConsoleSmsProvider').ConsoleSmsProvider.outbox;
  const app = require('../src/app').default;
  server = http.createServer(app).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  setTimeout(() => process.exit(0), 100).unref();
});

// Every call gets its own fake client IP so the per-IP rate limiters do not interfere.
let ipN = 0;
type Opts = { token?: string; gate?: string; cookie?: string; ip?: string };
const call = async (method: string, path: string, body?: unknown, o: Opts = {}) => {
  const headers: Record<string, string> = { 'x-forwarded-for': o.ip ?? `10.1.${Math.floor(++ipN / 250)}.${ipN % 250}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.gate) headers['x-parent-gate'] = o.gate;
  if (o.cookie) headers.cookie = o.cookie;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json: any = await res.json().catch(() => ({}));
  return { status: res.status, json, cookies: res.headers.getSetCookie().map((c) => c.split(';')[0]) };
};

const lastCode = () => {
  const m = outbox[outbox.length - 1]?.message.match(/\b(\d{6})\b/);
  assert.ok(m, 'an SMS with a code was sent');
  return m![1];
};
/** Pretend a minute+ has passed so the resend cooldown and hourly cap do not block the test. */
const ageOtps = (minutes = 120) =>
  q(`UPDATE otp_codes SET created_at = created_at - ($1 || ' minutes')::interval`, [String(minutes)]);

const consent = { accepted: true, is_guardian: true, version: '' };
let parentToken = '';
let parentId = '';
let gate = '';
let kidId = '';
let deviceCookie = '';

// ── token hygiene ────────────────────────────────────────────────────────────

test('login tokens never contain password or PIN hashes', async () => {
  const { buildTokenPayload } = require('../src/utils/sendToken');
  const p1 = buildTokenPayload({ id: '1', role: 'parent', name: 'A', email: 'a@b.co', password: '$2b$12$secret', phone: '+254712345678' });
  const p2 = buildTokenPayload({ id: '2', role: 'kid', name: 'K', parent_id: 'p', pin_hash: '$2b$12$pin', username: 'k' });
  assert.equal(JSON.stringify(p1).includes('secret'), false);
  assert.equal(JSON.stringify(p2).includes('pin'), false);
  assert.equal(p2.parent_id, 'p');
});

// ── phone sign-up with SMS code ──────────────────────────────────────────────

test('phone sign-up: code is sent, wrong code fails, right code creates a parent and works once', async () => {
  const phone = '0712000111';
  const r1 = await call('POST', '/api/v1/auth/otp/request', { phone, purpose: 'signup' });
  assert.equal(r1.status, 200);
  assert.equal(outbox[outbox.length - 1].to, '+254712000111');
  const code = lastCode();

  // The code is stored only as a keyed hash.
  const stored = (await q('SELECT code_hash FROM otp_codes ORDER BY created_at DESC LIMIT 1')).rows[0].code_hash;
  assert.equal(stored.includes(code), false);
  assert.equal(stored.length, 64);

  const wrong = await call('POST', '/api/v1/auth/otp/verify', { phone, purpose: 'signup', code: code === '000000' ? '111111' : '000000', name: 'Wanjiru K', accept_terms: true });
  assert.equal(wrong.status, 401);

  const noTerms = await call('POST', '/api/v1/auth/otp/verify', { phone, purpose: 'signup', code, name: 'Wanjiru K' });
  assert.equal(noTerms.status, 400); // rejected BEFORE the code is used up

  const ok = await call('POST', '/api/v1/auth/otp/verify', { phone, purpose: 'signup', code, name: 'Wanjiru K', accept_terms: true });
  assert.equal(ok.status, 201);
  assert.ok(ok.json.accessToken);
  const u = (await q(`SELECT role, email, password, phone, phone_verified FROM users WHERE phone = '+254712000111'`)).rows[0];
  assert.deepEqual([u.role, u.email, u.password, u.phone_verified], ['parent', null, null, true]);

  const again = await call('POST', '/api/v1/auth/otp/verify', { phone, purpose: 'signup', code, name: 'Wanjiru K', accept_terms: true });
  assert.equal(again.status, 401); // a code works exactly once
});

test('OTP: a code dies after 5 wrong guesses, even if the right one is then tried', async () => {
  const phone = '0712000222';
  await call('POST', '/api/v1/auth/otp/request', { phone, purpose: 'signup' });
  const code = lastCode();
  const bad = code === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) {
    const r = await call('POST', '/api/v1/auth/otp/verify', { phone, purpose: 'signup', code: bad, name: 'Test User', accept_terms: true });
    assert.equal(r.status, 401);
  }
  const late = await call('POST', '/api/v1/auth/otp/verify', { phone, purpose: 'signup', code, name: 'Test User', accept_terms: true });
  assert.equal(late.status, 401);
});

test('OTP sending is limited per phone: cooldown, then 3 per hour', async () => {
  const phone = '0712000333';
  assert.equal((await call('POST', '/api/v1/auth/otp/request', { phone, purpose: 'signup' })).status, 200);
  const tooSoon = await call('POST', '/api/v1/auth/otp/request', { phone, purpose: 'signup' });
  assert.equal(tooSoon.status, 429);

  // two more sends, each after the cooldown
  await q(`UPDATE otp_codes SET created_at = now() - interval '2 minutes' WHERE phone = '+254712000333'`);
  assert.equal((await call('POST', '/api/v1/auth/otp/request', { phone, purpose: 'signup' })).status, 200);
  await q(`UPDATE otp_codes SET created_at = now() - interval '3 minutes' WHERE phone = '+254712000333'`);
  assert.equal((await call('POST', '/api/v1/auth/otp/request', { phone, purpose: 'signup' })).status, 200);
  await q(`UPDATE otp_codes SET created_at = now() - interval '4 minutes' WHERE phone = '+254712000333'`);
  const fourth = await call('POST', '/api/v1/auth/otp/request', { phone, purpose: 'signup' });
  assert.equal(fourth.status, 429);
});

test('OTP sending is limited per IP', async () => {
  const ip = '203.0.113.9';
  let last = 0;
  for (let i = 0; i < 7; i++) {
    last = (await call('POST', '/api/v1/auth/otp/request', { phone: `07120009${String(i).padStart(2, '0')}`, purpose: 'signup' }, { ip })).status;
  }
  assert.equal(last, 429);
});

test('OTP has a site-wide daily cap (SMS costs money)', async () => {
  await q(`INSERT INTO otp_codes (phone, purpose, code_hash, expires_at)
           SELECT '+2547999' || g, 'signup', 'x', now() + interval '10 minutes' FROM generate_series(1, 400) g`);
  const r = await call('POST', '/api/v1/auth/otp/request', { phone: '0712000444', purpose: 'signup' });
  assert.equal(r.status, 503);
  await q(`DELETE FROM otp_codes WHERE code_hash = 'x'`);
});

test('phone login: same answer for unknown numbers and sends no SMS; admins cannot use it', async () => {
  await ageOtps();
  const before = outbox.length;
  const unknown = await call('POST', '/api/v1/auth/otp/request', { phone: '0799999999', purpose: 'login' });
  assert.equal(unknown.status, 200);
  assert.equal(outbox.length, before);

  await q(`INSERT INTO users (name, email, phone, password, role, is_verified) VALUES ('Boss','boss@x.co','0733000001',$1,'admin',true)`, [bcrypt.hashSync('Passw0rd1', 4)]);
  const admin = await call('POST', '/api/v1/auth/otp/request', { phone: '0733000001', purpose: 'login' });
  assert.equal(admin.status, 200);
  assert.equal(outbox.length, before); // no text sent to an admin number

  // existing parent (signed up above) can log in with a code, even though stored in a different spelling
  await q(`UPDATE users SET phone = '0712000111' WHERE phone = '+254712000111'`);
  await ageOtps();
  const ok = await call('POST', '/api/v1/auth/otp/request', { phone: '+254 712 000 111', purpose: 'login' });
  assert.equal(ok.status, 200);
  assert.equal(outbox.length, before + 1);
  const login = await call('POST', '/api/v1/auth/otp/verify', { phone: '+254712000111', purpose: 'login', code: lastCode() });
  assert.equal(login.status, 200);
  assert.ok(login.json.accessToken);
});

test('email sign-up can no longer ask for admin and treats any spelling of a phone as taken', async () => {
  const dup = await call('POST', '/api/v1/auth/register', { name: 'Dup User', email: 'dup@x.co', phone: '+254712000111', password: 'Passw0rd1', role: 'admin' });
  assert.equal(dup.status, 400); // phone already registered as 0712000111
});

// ── parent with email + password ─────────────────────────────────────────────

test('parent logs in and passes the parent gate with their password', async () => {
  await q(`INSERT INTO users (name, email, phone, password, role, is_verified) VALUES ('Mama P','mama@x.co','0722000001',$1,'parent',true)`, [bcrypt.hashSync('Passw0rd1', 4)]);
  const login = await call('POST', '/api/v1/auth/login', { email: 'mama@x.co', password: 'Passw0rd1' });
  assert.equal(login.status, 200);
  parentToken = login.json.accessToken;
  parentId = login.json.data.user.id;

  const blocked = await call('POST', '/api/v1/kids/device/link', undefined, { token: parentToken });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.code, 'PARENT_GATE_REQUIRED');

  const wrong = await call('POST', '/api/v1/auth/parent-gate', { password: 'nope-nope1' }, { token: parentToken });
  assert.equal(wrong.status, 401);
  const ok = await call('POST', '/api/v1/auth/parent-gate', { password: 'Passw0rd1' }, { token: parentToken });
  assert.equal(ok.status, 200);
  gate = ok.json.data.gateToken;

  // a gate token belongs to one parent only
  await q(`INSERT INTO users (name, email, phone, password, role, is_verified) VALUES ('Other','other@x.co','0722000002',$1,'parent',true)`, [bcrypt.hashSync('Passw0rd1', 4)]);
  const other = await call('POST', '/api/v1/auth/login', { email: 'other@x.co', password: 'Passw0rd1' });
  const stolen = await call('POST', '/api/v1/kids/device/link', undefined, { token: other.json.accessToken, gate });
  assert.equal(stolen.status, 403);
});

test('a phone-only parent passes the gate with a texted code', async () => {
  await ageOtps();
  const login = await call('POST', '/api/v1/auth/otp/request', { phone: '0712000111', purpose: 'login' });
  assert.equal(login.status, 200);
  const l = await call('POST', '/api/v1/auth/otp/verify', { phone: '0712000111', purpose: 'login', code: lastCode() });
  await ageOtps();
  assert.equal((await call('POST', '/api/v1/auth/parent-gate/otp', undefined, { token: l.json.accessToken })).status, 200);
  const g = await call('POST', '/api/v1/auth/parent-gate', { code: lastCode() }, { token: l.json.accessToken });
  assert.equal(g.status, 200);
  assert.ok(g.json.data.gateToken);
});

// ── consent + child profile ──────────────────────────────────────────────────

test('a child profile cannot be created without consent; with consent both rows exist together', async () => {
  const doc = await call('GET', '/api/v1/kids/consent-document');
  assert.equal(doc.status, 200);
  consent.version = doc.json.data.version;

  const none = await call('POST', '/api/v1/kids/register', { name: 'Zuri', age: 8 }, { token: parentToken });
  assert.equal(none.status, 400);
  const notGuardian = await call('POST', '/api/v1/kids/register', { name: 'Zuri', age: 8, consent: { ...consent, is_guardian: false } }, { token: parentToken });
  assert.equal(notGuardian.status, 400);
  const stale = await call('POST', '/api/v1/kids/register', { name: 'Zuri', age: 8, consent: { ...consent, version: 'old' } }, { token: parentToken });
  assert.equal(stale.status, 409);
  assert.equal((await q('SELECT count(*)::int c FROM kids WHERE parent_id = $1', [parentId])).rows[0].c, 0);

  const ok = await call('POST', '/api/v1/kids/register', { name: 'Zuri', age: 8, avatar: 'lion', consent }, { token: parentToken });
  assert.equal(ok.status, 201);
  kidId = ok.json.data.kid.id;
  const c = (await q('SELECT policy_version, is_guardian, ip FROM parental_consents WHERE kid_id = $1', [kidId])).rows[0];
  assert.equal(c.policy_version, consent.version);
  assert.equal(c.is_guardian, true);
  assert.ok(c.ip);
});

test('setting a PIN needs the gate; family-device picker shows avatars only and logs in with the PIN', async () => {
  assert.equal((await call('PUT', `/api/v1/kids/${kidId}/pin`, { pin: '4321' }, { token: parentToken })).status, 403);
  assert.equal((await call('PUT', `/api/v1/kids/${kidId}/pin`, { pin: '12' }, { token: parentToken, gate })).status, 400);
  assert.equal((await call('PUT', `/api/v1/kids/${kidId}/pin`, { pin: '4321' }, { token: parentToken, gate })).status, 200);

  // picker does not work on an unlinked browser
  assert.equal((await call('GET', '/api/v1/kids/picker')).status, 401);
  const link = await call('POST', '/api/v1/kids/device/link', undefined, { token: parentToken, gate });
  assert.equal(link.status, 200);
  deviceCookie = link.cookies.find((c) => c.startsWith('akili_device='))!;
  assert.ok(deviceCookie);

  const list = await call('GET', '/api/v1/kids/picker', undefined, { cookie: deviceCookie });
  assert.equal(list.status, 200);
  assert.deepEqual(Object.keys(list.json.data.kids[0]).sort(), ['avatar', 'id', 'name', 'needs_new_pin']);

  const bad = await call('POST', '/api/v1/kids/picker/login', { kid_id: kidId, pin: '0000' }, { cookie: deviceCookie });
  assert.equal(bad.status, 401);
  const good = await call('POST', '/api/v1/kids/picker/login', { kid_id: kidId, pin: '4321' }, { cookie: deviceCookie });
  assert.equal(good.status, 200);
  assert.equal(good.json.data.kid.role, 'kid');
  // the kid's token carries no hashes
  const payload = JSON.parse(Buffer.from(good.json.accessToken.split('.')[1], 'base64url').toString());
  assert.equal(payload.parent_id, parentId);
  assert.equal(JSON.stringify(payload).includes('$2'), false);
});

test('a child cannot use the picker for someone else’s child', async () => {
  const other = (await q(`SELECT id FROM users WHERE email = 'other@x.co'`)).rows[0].id;
  const k = (await q(`INSERT INTO kids (parent_id, name, age, pin_hash) VALUES ($1,'Ben',9,$2) RETURNING id`, [other, bcrypt.hashSync('1111', 4)])).rows[0].id;
  const r = await call('POST', '/api/v1/kids/picker/login', { kid_id: k, pin: '1111' }, { cookie: deviceCookie });
  assert.equal(r.status, 401);
});

test('5 wrong PINs lock the child for 15 minutes — even the right PIN is refused', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await call('POST', '/api/v1/kids/picker/login', { kid_id: kidId, pin: '9999' }, { cookie: deviceCookie });
    assert.ok([401, 429].includes(r.status));
  }
  const locked = await call('POST', '/api/v1/kids/picker/login', { kid_id: kidId, pin: '4321' }, { cookie: deviceCookie });
  assert.equal(locked.status, 429);
  assert.match(locked.json.message, /Too many tries/);
  await q('UPDATE kids SET pin_locked_until = NULL, pin_failed_attempts = 0 WHERE id = $1', [kidId]);
});

test('withdrawn consent switches the child account off', async () => {
  await q('UPDATE parental_consents SET withdrawn_at = now() WHERE kid_id = $1', [kidId]);
  const r = await call('POST', '/api/v1/kids/picker/login', { kid_id: kidId, pin: '4321' }, { cookie: deviceCookie });
  assert.equal(r.status, 403);
  await q('UPDATE parental_consents SET withdrawn_at = NULL WHERE kid_id = $1', [kidId]);
});

// ── screen time ──────────────────────────────────────────────────────────────

test('screen time: parent sets a limit; child heartbeats count up (cannot be inflated) and lessons lock at the limit', async () => {
  assert.equal((await call('PUT', `/api/v1/kids/${kidId}/screen-time`, { daily_limit_minutes: 1 }, { token: parentToken })).status, 403);
  const set = await call('PUT', `/api/v1/kids/${kidId}/screen-time`, { daily_limit_minutes: 1, break_every_minutes: 20 }, { token: parentToken, gate });
  assert.equal(set.status, 200);
  assert.equal(set.json.data.screen_time.limit_minutes, 1);
  assert.equal((await call('PUT', `/api/v1/kids/${kidId}/screen-time`, { daily_limit_minutes: 5000 }, { token: parentToken, gate })).status, 400);

  const kid = await call('POST', '/api/v1/kids/picker/login', { kid_id: kidId, pin: '4321' }, { cookie: deviceCookie });
  const t = kid.json.accessToken;

  // a page claiming 300 seconds is rejected outright; 65 is the most one ping can add, and never more than real elapsed time
  assert.equal((await call('POST', '/api/v1/kids/me/heartbeat', { seconds: 300 }, { token: t })).status, 400);
  await call('POST', '/api/v1/kids/me/heartbeat', { seconds: 60 }, { token: t });          // first ping: starts the clock
  const second = await call('POST', '/api/v1/kids/me/heartbeat', { seconds: 60 }, { token: t }); // immediately again
  assert.ok(second.json.data.screen_time.used_seconds <= 2, 'only real elapsed time is counted');

  // pretend the child has used the whole minute
  await q(`UPDATE kid_usage_daily SET seconds = 60 WHERE kid_id = $1`, [kidId]);
  const lesson = await call('GET', `/api/v1/kids/courses/${'6f1c2f4e-8a3b-4c1d-9e2f-1a2b3c4d5e6f'}/content`, undefined, { token: t });
  assert.equal(lesson.status, 403);
  assert.equal(lesson.json.code, 'SCREEN_TIME_UP');

  // the dashboard route is not blocked: the child can still see their own stats
  const me = await call('GET', '/api/v1/kids/me/screen-time', undefined, { token: t });
  assert.equal(me.json.data.screen_time.locked, true);
});

test('children cannot reach parent endpoints or parent learning data', async () => {
  const kid = await call('POST', '/api/v1/kids/picker/login', { kid_id: kidId, pin: '4321' }, { cookie: deviceCookie });
  assert.equal((await call('GET', '/api/v1/kids/my-kids', undefined, { token: kid.json.accessToken })).status, 403);
  assert.equal((await call('PUT', `/api/v1/kids/${kidId}/screen-time`, { daily_limit_minutes: null }, { token: kid.json.accessToken, gate })).status, 403);
  // parent token on the child-only learning API
  assert.equal((await call('GET', '/api/v1/learning/courses', undefined, { token: parentToken })).status, 403);
});

// ── validation of child-submitted data ───────────────────────────────────────

test('what children submit is validated: ids, sizes, links', async () => {
  const kid = await call('POST', '/api/v1/kids/picker/login', { kid_id: kidId, pin: '4321' }, { cookie: deviceCookie });
  await q('UPDATE kids SET screen_time_daily_minutes = NULL WHERE id = $1', [kidId]); // unlock for this test
  const t = kid.json.accessToken;
  const lessonUrl = '/api/v1/learning/courses/6f1c2f4e-8a3b-4c1d-9e2f-1a2b3c4d5e6f/lessons/6f1c2f4e-8a3b-4c1d-9e2f-1a2b3c4d5e6f/submit';
  assert.equal((await call('POST', '/api/v1/learning/courses/not-an-id/lessons/x/submit', { code_submitted: 'x' }, { token: t })).status, 400);
  assert.equal((await call('POST', lessonUrl, { code_submitted: 'x'.repeat(30000) }, { token: t })).status, 400);
  assert.equal((await call('POST', '/api/v1/submissions', { lesson_id: 'x', enrollment_id: 'y', github_url: 'http://evil.example/x' }, { token: t })).status, 400);
  assert.equal((await call('GET', '/api/v1/kid/calendar?year=2026', undefined, { token: t })).status, 400);
  assert.equal((await call('GET', '/api/v1/kid/calendar?year=abc&month=1', undefined, { token: t })).status, 400);
});

// ── admin: pricing, injection, user routes ───────────────────────────────────

test('admin pricing: unknown fields can never reach SQL; users page route exists; roles are protected', async () => {
  const login = await call('POST', '/api/v1/auth/login', { email: 'boss@x.co', password: 'Passw0rd1' });
  const at = login.json.accessToken;
  const adminId = login.json.data.user.id;

  const plan = await call('POST', '/api/v1/pricing/admin/plans', { name: 'Test', billing_cycle: 'monthly', price: 1500, duration_months: 1 }, { token: at });
  assert.equal(plan.status, 201);
  const planId = plan.json.data.plan.id;

  const evil = await call('PUT', `/api/v1/pricing/admin/plans/${planId}`, { 'price = 1; DROP TABLE users; --': 1 }, { token: at });
  assert.equal(evil.status, 400); // nothing valid to update
  const strip = await call('PUT', `/api/v1/pricing/admin/plans/${planId}`, { price: 1800, 'name = (SELECT 1); --': 'x' }, { token: at });
  assert.equal(strip.status, 200);
  assert.equal(Number(strip.json.data.plan.price), 1800);
  assert.equal((await q('SELECT count(*)::int c FROM users')).rows[0].c > 0, true);

  assert.equal((await call('PUT', `/api/v1/pricing/admin/plans/${planId}`, { price: -5 }, { token: at })).status, 400);
  assert.equal((await call('POST', '/api/v1/pricing/admin/coupons', { code: 'A B', discount_type: 'percentage', discount_value: 150, applies_to: 'once' }, { token: at })).status, 400);

  // the admin users list (the old mount made this URL 404)
  const list = await call('GET', '/api/v1/admin/users', undefined, { token: at });
  assert.equal(list.status, 200);
  // the old unfinished public auth copy is gone
  assert.equal((await call('POST', '/api/v1/admin/users/auth/register', { name: 'x' })).status, 404);

  assert.equal((await call('PATCH', `/api/v1/admin/users/${adminId}/role`, { role: 'parent' }, { token: at })).status, 400); // not yourself
  assert.equal((await call('PATCH', `/api/v1/admin/users/${parentId}/role`, { role: 'superuser' }, { token: at })).status, 400);
  assert.equal((await call('DELETE', `/api/v1/admin/users/${adminId}`, undefined, { token: at })).status, 403); // admins are not deletable here

  // parents cannot touch admin endpoints
  assert.equal((await call('GET', '/api/v1/admin/users', undefined, { token: parentToken })).status, 403);
});

// ── short Paybill reference ──────────────────────────────────────────────────

test('every enrollment has a short typeable reference, and a Paybill payment using it is parked for approval', async () => {
  const course = (await q(`INSERT INTO courses (title, price) VALUES ('Python', 3000) RETURNING id`)).rows[0].id;
  const enr = (await q(
    `INSERT INTO enrollments (kid_id, parent_id, course_id, course_name, fee_amount, billing_cycle, status)
     VALUES ($1,$2,$3,'Python',3000,'monthly','pending') RETURNING id, pay_ref`, [kidId, parentId, course])).rows[0];
  assert.match(enr.pay_ref, /^AK[A-Z0-9]{6}$/);

  const { handleC2bConfirmation } = require('../src/services/paymentService');
  const phone = (await q('SELECT phone FROM users WHERE id = $1', [parentId])).rows[0].phone;
  const msisdn = '254' + phone.replace(/^0/, '');
  const typed = ` ${enr.pay_ref.toLowerCase().slice(0, 4)} ${enr.pay_ref.slice(4)} `; // lowercase, with stray spaces
  const out = await handleC2bConfirmation({ TransID: 'QWE12345AB', TransAmount: '3000', MSISDN: msisdn, BillRefNumber: typed, BusinessShortCode: '174379' });
  assert.equal(out, 'review');
  assert.equal((await q(`SELECT status FROM payments WHERE mpesa_receipt = 'QWE12345AB'`)).rows[0].status, 'review');
});

// ── export & delete ──────────────────────────────────────────────────────────

test('data export needs the gate, never includes the PIN hash, and delete keeps money records but removes the child', async () => {
  assert.equal((await call('GET', `/api/v1/kids/${kidId}/export`, undefined, { token: parentToken })).status, 403);
  const exp = await call('GET', `/api/v1/kids/${kidId}/export`, undefined, { token: parentToken, gate });
  assert.equal(exp.status, 200);
  assert.equal(exp.json.child.name, 'Zuri');
  assert.equal(JSON.stringify(exp.json).includes('pin_hash'), false);
  assert.equal(JSON.stringify(exp.json).includes('$2'), false);
  assert.ok(exp.json.consents.length >= 1);

  // another parent cannot export this child
  const other = await call('POST', '/api/v1/auth/login', { email: 'other@x.co', password: 'Passw0rd1' });
  const og = await call('POST', '/api/v1/auth/parent-gate', { password: 'Passw0rd1' }, { token: other.json.accessToken });
  assert.equal((await call('GET', `/api/v1/kids/${kidId}/export`, undefined, { token: other.json.accessToken, gate: og.json.data.gateToken })).status, 404);

  // a completed payment must survive the deletion
  const enrId = (await q('SELECT id FROM enrollments WHERE kid_id = $1', [kidId])).rows[0].id;
  await q(`INSERT INTO payments (enrollment_id, kid_id, parent_id, amount, method, receipt_number, status, description)
           VALUES ($1,$2,$3,3000,'M-Pesa','RCP-KEEP-1','completed','Fee for Zuri — Python')`, [enrId, kidId, parentId]);
  await q(`UPDATE payments SET status = 'failed' WHERE status = 'review'`); // the parked Paybill row would block deletion by design

  assert.equal((await call('DELETE', `/api/v1/kids/${kidId}`, { confirm_name: 'wrong' }, { token: parentToken, gate })).status, 400);
  assert.equal((await call('DELETE', `/api/v1/kids/${kidId}`, { confirm_name: 'zuri' }, { token: parentToken })).status, 403);
  const del = await call('DELETE', `/api/v1/kids/${kidId}`, { confirm_name: 'zuri' }, { token: parentToken, gate });
  assert.equal(del.status, 200);

  assert.equal((await q('SELECT count(*)::int c FROM kids WHERE id = $1', [kidId])).rows[0].c, 0);
  assert.equal((await q('SELECT count(*)::int c FROM enrollments WHERE kid_id = $1', [kidId])).rows[0].c, 0);
  const kept = (await q(`SELECT kid_id, enrollment_id, description, amount FROM payments WHERE receipt_number = 'RCP-KEEP-1'`)).rows[0];
  assert.equal(kept.kid_id, null);
  assert.equal(kept.enrollment_id, null);
  assert.equal(kept.description.includes('Zuri'), false);
  assert.equal(Number(kept.amount), 3000);
  assert.equal((await q(`SELECT count(*)::int c FROM parental_consents WHERE parent_id = $1 AND kid_id IS NULL AND withdrawn_at IS NOT NULL`, [parentId])).rows[0].c, 1);
  assert.equal((await q(`SELECT count(*)::int c FROM audit_logs WHERE action = 'KID_DELETED'`)).rows[0].c, 1);
});

test('a payment still being confirmed blocks deletion', async () => {
  const k = (await q(`INSERT INTO kids (parent_id, name, age) VALUES ($1,'Tmp',7) RETURNING id`, [parentId])).rows[0].id;
  await q(`INSERT INTO payments (kid_id, parent_id, amount, method, receipt_number, status) VALUES ($1,$2,100,'M-Pesa','RCP-PEND-1','pending')`, [k, parentId]);
  const r = await call('DELETE', `/api/v1/kids/${k}`, { confirm_name: 'Tmp' }, { token: parentToken, gate });
  assert.equal(r.status, 409);
  await q(`DELETE FROM payments WHERE receipt_number = 'RCP-PEND-1'`);
  await q(`DELETE FROM kids WHERE id = $1`, [k]);
});

test('account deletion erases the parent, keeps anonymous money records, and an admin cannot be deleted this way', async () => {
  assert.equal((await call('DELETE', '/api/v1/auth/me', { confirm: 'DELETE' }, { token: parentToken })).status, 403); // gate
  assert.equal((await call('DELETE', '/api/v1/auth/me', { confirm: 'yes' }, { token: parentToken, gate })).status, 400);
  const exp = await call('GET', '/api/v1/auth/me/export', undefined, { token: parentToken, gate });
  assert.equal(exp.status, 200);
  assert.equal(exp.json.account.email, 'mama@x.co');
  assert.equal(JSON.stringify(exp.json).includes('"password"'), false);

  const del = await call('DELETE', '/api/v1/auth/me', { confirm: 'DELETE' }, { token: parentToken, gate });
  assert.equal(del.status, 200);
  assert.equal((await q(`SELECT count(*)::int c FROM users WHERE id = $1`, [parentId])).rows[0].c, 0);
  const kept = (await q(`SELECT parent_id, amount FROM payments WHERE receipt_number = 'RCP-KEEP-1'`)).rows[0];
  assert.equal(kept.parent_id, null);
  assert.equal(Number(kept.amount), 3000);
});
