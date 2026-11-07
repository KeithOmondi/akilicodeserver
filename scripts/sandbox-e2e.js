/**
 * End-to-end Daraja SANDBOX payment, driven through the real API.
 * See docs/DARAJA_SANDBOX_E2E.md for the full runbook. Prerequisites:
 *   - API running (npm run dev) against a database COPY with migrations applied
 *   - ngrok tunnel running and MPESA_CALLBACK_URL etc. updated to it
 *   - a verified parent account with one child, and one course
 *
 *   E2E_EMAIL=parent@example.com E2E_PASSWORD='...' node scripts/sandbox-e2e.js
 * Optional: E2E_API (default http://localhost:5000/api/v1), E2E_PHONE (default sandbox test number)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Client } = require('pg');

const API = (process.env.E2E_API || 'http://localhost:5000/api/v1').replace(/\/$/, '');
const PHONE = process.env.E2E_PHONE || '254708374149'; // Safaricom's sandbox test MSISDN
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (ok, msg) => console.log(`${ok === null ? '·' : ok ? '✔' : '✖'} ${msg}`);

const call = async (method, path, body, headers = {}) => {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

(async () => {
  if (process.env.MPESA_ENV !== 'sandbox') throw new Error('MPESA_ENV must be "sandbox"');
  if (process.env.USE_DB_BRANCH !== 'true') throw new Error('Start the API with USE_DB_BRANCH=true so it uses the Neon BRANCH, then run this again with USE_DB_BRANCH=true too');
  if (!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD) throw new Error('Set E2E_EMAIL and E2E_PASSWORD');

  // 1. log in + parent gate
  const login = await call('POST', '/auth/login', { email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD });
  if (login.status !== 200) throw new Error('login failed: ' + JSON.stringify(login.json));
  const auth = { authorization: `Bearer ${login.json.accessToken}` };
  const gate = await call('POST', '/auth/parent-gate', { password: process.env.E2E_PASSWORD }, auth);
  if (gate.status !== 200) throw new Error('parent gate failed: ' + JSON.stringify(gate.json));
  const hdr = { ...auth, 'x-parent-gate': gate.json.data.gateToken };
  say(true, 'logged in and passed the parent gate');

  // 2. a child and a course
  const kids = (await call('GET', '/kids/my-kids', undefined, auth)).json.data?.kids ?? [];
  const courses = (await call('GET', '/courses', undefined, auth)).json.data?.courses ?? [];
  if (!kids.length || !courses.length) throw new Error('need at least one child and one course');
  const kid = kids[0], course = courses[0];
  say(null, `child "${kid.name}", course "${course.title}" (KES ${course.price})`);

  // 3. enrollment at the real server-side price
  const enr = await call('POST', '/enrollments/create', {
    kid_id: kid.id, course_id: course.id, fee_amount: Number(course.price), billing_cycle: 'monthly',
  }, auth);
  if (enr.status !== 201) throw new Error('enroll failed: ' + JSON.stringify(enr.json));
  const enrollment = enr.json.data.enrollment;
  say(true, `enrollment ${enrollment.id} created as "${enrollment.status}", pay reference ${enrollment.pay_ref}`);

  // 4. STK push — NOTE: no amount is sent; the server uses the enrollment's fee
  const push = await call('POST', '/mpesa/stk-push', { enrollment_id: enrollment.id, phone: PHONE }, hdr);
  if (push.status !== 200) throw new Error('stk-push failed: ' + JSON.stringify(push.json));
  const checkout = push.json.data.CheckoutRequestID;
  say(true, `STK push sent (CheckoutRequestID ${checkout}); amount charged by server: KES ${push.json.data.amount}`);

  // 5. before Safaricom answers: access must still be locked
  const early = await call('GET', `/enrollments/${enrollment.id}`, undefined, auth);
  say(null, `enrollment status right after the push: ${early.json.data?.enrollment?.status ?? early.status}`);

  // 6. poll like the website does (each poll makes the server ask Safaricom)
  let final = 'pending';
  for (let i = 0; i < 30 && final === 'pending'; i++) {
    await sleep(4000);
    const s = await call('GET', `/mpesa/status/${enrollment.id}`, undefined, auth);
    final = s.json.data?.payment_status ?? 'unknown';
    process.stdout.write(`  poll ${i + 1}: ${final}\r`);
  }
  console.log('');
  say(final === 'completed', `final payment status: ${final}`);

  // 7. forged callbacks must change nothing
  const base = process.env.MPESA_CALLBACK_URL;
  const forged = (id) => ({ Body: { stkCallback: { MerchantRequestID: 'x', CheckoutRequestID: id, ResultCode: 0, ResultDesc: 'ok',
    CallbackMetadata: { Item: [{ Name: 'Amount', Value: 1 }, { Name: 'MpesaReceiptNumber', Value: 'FORGED0001' }, { Name: 'PhoneNumber', Value: 254700000000 }] } } } });
  const wrongSecret = await fetch(`${base}/wrong-secret`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(forged(checkout)) });
  say(wrongSecret.status === 404, `callback with a wrong secret -> HTTP ${wrongSecret.status} (expected 404)`);
  const unknown = await fetch(`${base}/${process.env.MPESA_CALLBACK_SECRET}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(forged('ws_CO_FAKE_NOT_OURS')) });
  say(unknown.status === 200, `callback for an id we never created -> HTTP ${unknown.status} (acknowledged, ignored)`);

  // 8. what the database says (read-only)
  const db = new Client({ connectionString: require('./lib/db-target')(['--branch']), ssl: { rejectUnauthorized: false } });
  await db.connect();
  await db.query('BEGIN READ ONLY');
  const ev = await db.query(`SELECT created_at, source, outcome FROM payment_events WHERE checkout_request_id = $1 OR outcome IN ('bad_secret','unknown_checkout') ORDER BY created_at`, [checkout]);
  console.log('\npayment_events:'); ev.rows.forEach((r) => console.log('  ', r.created_at.toISOString(), r.source.padEnd(13), r.outcome));
  const p = (await db.query(`SELECT status, amount, mpesa_receipt, phone, verified_at FROM payments WHERE checkout_request_id = $1`, [checkout])).rows[0];
  const e = (await db.query(`SELECT status, payment_status, total_paid FROM enrollments WHERE id = $1`, [enrollment.id])).rows[0];
  await db.query('ROLLBACK'); await db.end();
  console.log('\npayment   :', p);
  console.log('enrollment:', e);
  const ok = final === 'completed' && e.status === 'active' && e.payment_status === 'paid' && Number(e.total_paid) === Number(p.amount) && p.verified_at;
  say(ok, ok ? 'PASS: the course unlocked only after the STK Query confirmed it, exactly once.' : 'FAIL: see output above.');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('✖', e.message); process.exit(1); });
