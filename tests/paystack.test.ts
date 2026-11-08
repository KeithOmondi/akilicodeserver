/**
 * Paystack (cards only; M-Pesa has its own integration). Runs the REAL payment SQL against an in-process Postgres (pglite).
 * Paystack itself is replaced by a fake that answers "what really happened to this reference?".
 * The rules under test: nothing is unlocked until Paystack confirms it, the money must match, a payment is
 * completed at most once, and a webhook is only a hint (and must carry a valid signature).
 */
import './setup';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

let db: any;
let svc: typeof import('../src/services/paymentService');
let C: typeof import('../src/controllers/paystackController');
let ps: typeof import('../src/utils/paystack');

// What the fake Paystack says about a reference, and what we asked it to start.
let verifyResult: any = { status: 'success', amount: 400000, currency: 'KES' };
let verifyCalls = 0;
let initCalls: any[] = [];
let initFails = false;
const SECRET = 'sk_test_' + 'p'.repeat(30);

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
  for (const m of ['001_payment_hardening', '002_phase2_accounts', '006_paystack', '007_free_trial']) await db.exec(fs.readFileSync(path.join(root, `migrations/${m}.sql`), 'utf8'));

  const run = async (sql: string, params?: any[]) => {
    const r = await db.query(sql, params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  fakeModule('../src/config/db', { __esModule: true, default: { query: run, connect: async () => ({ query: run, release() {} }), on() {} }, query: run });
  fakeModule('../src/utils/mailsTemplate', { sendReceiptEmail: async () => {} });
  fakeModule('../src/utils/mpesa', { querySTKStatus: async () => ({ ResultCode: '4999' }) });

  // keep the real signature check and amount maths; replace only the two calls that would reach Paystack
  const real = require('../src/utils/paystack');
  fakeModule('../src/utils/paystack', {
    ...real,
    verifyTransaction: async (reference: string) => {
      verifyCalls++;
      if (verifyResult instanceof Error) throw verifyResult;
      return { reference, ...verifyResult };
    },
    initializeTransaction: async (p: any) => {
      initCalls.push(p);
      if (initFails) throw Object.assign(new Error('Paystack down'), { response: { status: 503, data: { message: 'down' } } });
      return { authorization_url: `https://checkout.paystack.com/${p.reference}`, access_code: 'ac', reference: p.reference };
    },
  });
  ps = require('../src/utils/paystack');
  svc = require('../src/services/paymentService');
  C = require('../src/controllers/paystackController');
});

let n = 0;
const seed = async (opts: { fee?: number; email?: string | null } = {}) => {
  n++;
  const fee = opts.fee ?? 4000;
  const email = opts.email === undefined ? `ps${n}@x.co` : opts.email;
  const u = (await db.query(`INSERT INTO users (name,email,phone,password,is_verified) VALUES ('P',$1,$2,'x',true) RETURNING id`, [email, `07${30000000 + n}`])).rows[0].id;
  const k = (await db.query(`INSERT INTO kids (parent_id,name,age) VALUES ($1,'K',8) RETURNING id`, [u])).rows[0].id;
  const e = (await db.query(`INSERT INTO enrollments (kid_id,parent_id,course_name,fee_amount,billing_cycle,status) VALUES ($1,$2,'Course',$3,'monthly','pending') RETURNING id`, [k, u, fee])).rows[0].id;
  const ref = `AKTEST${n}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const p = (await db.query(
    `INSERT INTO payments (enrollment_id,kid_id,parent_id,amount,method,reference,receipt_number,status,source,paystack_reference,date)
     VALUES ($1,$2,$3,$4,'Paystack',$5,$6,'pending','paystack',$5,now()) RETURNING *`,
    [e, k, u, fee, ref, `RCP-PS-${n}`]
  )).rows[0];
  return { u, k, e, p, ref, fee };
};
const status = async (id: string) => (await db.query('SELECT status FROM payments WHERE id=$1', [id])).rows[0].status;
const enr = async (id: string) => (await db.query('SELECT * FROM enrollments WHERE id=$1', [id])).rows[0];
const backdate = (id: string, minutes: number) => db.query(`UPDATE payments SET created_at = now() - ($2 || ' minutes')::interval WHERE id = $1`, [id, String(minutes)]);

const call = async (handler: any, req: any) => {
  let body: any; let statusCode = 200; let error: any = null;
  const res: any = { status(c: number) { statusCode = c; return res; }, json(b: any) { body = b; return res; } };
  await handler(req, res, (e: any) => { error = e; });
  return { status: statusCode, body, error };
};
const asParent = (id: string, extra: any = {}) => ({ user: { id, role: 'parent' }, params: {}, body: {}, query: {}, ...extra });
const sign = (raw: string) => crypto.createHmac('sha512', SECRET).update(raw).digest('hex');
const webhook = (ref: string, event = 'charge.success') => JSON.stringify({ event, data: { reference: ref, status: 'success', amount: 1, currency: 'USD' } });

// ── the pure checks ──────────────────────────────────────────────────────────

test('amounts are sent to Paystack in the smallest unit (KES 4,000 is 400000)', () => {
  assert.equal(ps.toSubunit(4000), 400000);
  assert.equal(ps.toSubunit('1500.50'), 150050);
  assert.equal(ps.toSubunit(0.1 + 0.2), 30); // no floating point drift
});

test('the request to Paystack offers cards only, in KES, with the amount in the smallest unit', () => {
  const body = ps.buildInitializeBody({ email: 'a@b.co', amountKes: 4000, reference: 'AKREF123', callbackUrl: 'https://app.example.com/parent/programs', metadata: { x: 1 } });
  assert.deepEqual(body.channels, ['card']); // no mobile money / M-Pesa on Paystack's page
  assert.equal(body.currency, 'KES');
  assert.equal(body.amount, 400000);
  assert.equal(body.reference, 'AKREF123');
  assert.equal(body.callback_url, 'https://app.example.com/parent/programs');
});

test('webhook signature: only HMAC-SHA512 of the exact body with our secret key is accepted', () => {
  const body = JSON.stringify({ event: 'charge.success' });
  assert.equal(ps.isValidWebhookSignature(body, sign(body)), true);
  assert.equal(ps.isValidWebhookSignature(Buffer.from(body), sign(body)), true);
  assert.equal(ps.isValidWebhookSignature(body, sign(body).toUpperCase()), true); // hex case does not matter
  assert.equal(ps.isValidWebhookSignature(body + ' ', sign(body)), false); // body changed by one byte
  assert.equal(ps.isValidWebhookSignature(body, sign(body).slice(0, -2) + '00'), false);
  assert.equal(ps.isValidWebhookSignature(body, undefined), false);
  assert.equal(ps.isValidWebhookSignature(body, ''), false);
  assert.equal(ps.isValidWebhookSignature(body, 'abc'), false);
  const other = crypto.createHmac('sha512', 'sk_test_someone_else').update(body).digest('hex');
  assert.equal(ps.isValidWebhookSignature(body, other), false); // signed with a different key
});

test('mismatch check: reference, currency and amount must all be what we asked for', () => {
  const pay = { amount: '4000.00', paystack_reference: 'REF1' };
  assert.equal(svc.findPaystackMismatch(pay, { reference: 'REF1', currency: 'KES', amount: 400000 }), null);
  assert.match(svc.findPaystackMismatch(pay, { reference: 'REF2', currency: 'KES', amount: 400000 })!, /reference/);
  assert.match(svc.findPaystackMismatch(pay, { reference: 'REF1', currency: 'USD', amount: 400000 })!, /currency/);
  assert.match(svc.findPaystackMismatch(pay, { reference: 'REF1', currency: 'KES', amount: 10000 })!, /amount/);
});

// ── confirming a payment with Paystack ───────────────────────────────────────

test('a payment Paystack confirms unlocks the enrollment exactly once, and is recorded as a card payment', async () => {
  const { p, e } = await seed();
  verifyResult = { status: 'success', amount: 400000, currency: 'KES' };
  assert.equal(await svc.verifyAndApplyPaystack(p), 'completed');
  assert.equal(await svc.verifyAndApplyPaystack(p), 'duplicate'); // asking again changes nothing
  const row = await enr(e);
  assert.equal(row.status, 'active');
  assert.equal(row.payment_status, 'paid');
  assert.equal(Number(row.total_paid), 4000); // counted once
  assert.equal(row.mpesa_receipt_number, null); // a card payment never pretends to be an M-Pesa receipt
  const saved = (await db.query('SELECT method, source, mpesa_receipt FROM payments WHERE id=$1', [p.id])).rows[0];
  assert.equal(saved.method, 'Paystack');
  assert.equal(saved.mpesa_receipt, null);
});

test('nothing is unlocked while Paystack says the payment is not finished', async () => {
  for (const s of ['abandoned', 'ongoing', 'pending', 'queued']) {
    const { p, e } = await seed();
    verifyResult = { status: s, amount: 400000, currency: 'KES' };
    assert.equal(await svc.verifyAndApplyPaystack(p), 'pending', s);
    assert.equal(await status(p.id), 'pending');
    assert.equal((await enr(e)).status, 'pending');
  }
});

test('Paystack unreachable or "not found yet": stays pending, never guessed as paid, and is never unlocked', async () => {
  const { p, e } = await seed();
  verifyResult = Object.assign(new Error('timeout'), { response: { status: 404, data: { message: 'Transaction reference not found' } } });
  assert.equal(await svc.verifyAndApplyPaystack(p), 'pending');
  assert.equal((await enr(e)).status, 'pending');
});

test('a payment page left unfinished for over an hour shows as timed out, and can still be settled if paid later', async () => {
  const { p, e } = await seed();
  await backdate(p.id, 90);
  verifyResult = { status: 'abandoned', amount: 400000, currency: 'KES' };
  assert.equal(await svc.verifyAndApplyPaystack(p), 'expired');
  assert.equal(await status(p.id), 'expired');
  verifyResult = { status: 'success', amount: 400000, currency: 'KES' };
  assert.equal(await svc.verifyAndApplyPaystack({ ...p, status: 'expired' }), 'completed');
  assert.equal((await enr(e)).status, 'active');
});

test('a declined payment is marked failed with the reason, and a later success on the same page corrects it', async () => {
  const { p, e } = await seed();
  verifyResult = { status: 'failed', amount: 400000, currency: 'KES', gateway_response: 'Insufficient Funds' };
  assert.equal(await svc.verifyAndApplyPaystack(p), 'failed');
  const row = (await db.query('SELECT status, result_desc FROM payments WHERE id=$1', [p.id])).rows[0];
  assert.equal(row.status, 'failed');
  assert.match(row.result_desc, /Insufficient/);
  assert.equal((await enr(e)).status, 'pending');
  verifyResult = { status: 'success', amount: 400000, currency: 'KES' };
  assert.equal(await svc.verifyAndApplyPaystack({ ...p, status: 'failed' }), 'completed');
  assert.equal((await enr(e)).status, 'active');
});

test('money that does not match what we asked for goes to a person (review), and unlocks nothing', async () => {
  const cases: [string, any][] = [
    ['wrong amount', { status: 'success', amount: 100, currency: 'KES' }],
    ['wrong currency', { status: 'success', amount: 400000, currency: 'USD' }],
  ];
  for (const [name, result] of cases) {
    const { p, e } = await seed();
    verifyResult = result;
    assert.equal(await svc.verifyAndApplyPaystack(p), 'review', name);
    assert.equal(await status(p.id), 'review');
    assert.equal((await enr(e)).status, 'pending');
  }
  // an admin who has checked it can approve it: that is the same single path to "completed"
  const { p, e } = await seed();
  verifyResult = { status: 'success', amount: 100, currency: 'KES' };
  await svc.verifyAndApplyPaystack(p);
  assert.equal(await svc.resolveReview(p.id, true), true);
  assert.equal((await enr(e)).status, 'active');
});

// ── the webhook: a hint that must be signed ──────────────────────────────────

test('webhook with a wrong or missing signature is refused and changes nothing, and Paystack is not even asked', async () => {
  const { p, e, ref } = await seed();
  verifyResult = { status: 'success', amount: 400000, currency: 'KES' };
  const raw = webhook(ref);
  const before = verifyCalls;
  assert.equal(await svc.handlePaystackWebhook(Buffer.from(raw), 'deadbeef'), 'bad_signature');
  assert.equal(await svc.handlePaystackWebhook(Buffer.from(raw), undefined), 'bad_signature');
  assert.equal(await svc.handlePaystackWebhook(Buffer.from(raw + ' '), sign(raw)), 'bad_signature');
  assert.equal(verifyCalls, before);
  assert.equal(await status(p.id), 'pending');
  assert.equal((await enr(e)).status, 'pending');
});

test('a correctly signed webhook still only counts after Paystack itself confirms the payment', async () => {
  const { p, e, ref } = await seed();
  const raw = webhook(ref); // the webhook BODY claims USD / amount 1: it is ignored, the verified result is what counts
  verifyResult = { status: 'abandoned', amount: 400000, currency: 'KES' };
  assert.equal(await svc.handlePaystackWebhook(Buffer.from(raw), sign(raw)), 'pending'); // webhook says success, Paystack says no
  assert.equal((await enr(e)).status, 'pending');
  verifyResult = { status: 'success', amount: 400000, currency: 'KES' };
  assert.equal(await svc.handlePaystackWebhook(Buffer.from(raw), sign(raw)), 'completed');
  assert.equal(await svc.handlePaystackWebhook(Buffer.from(raw), sign(raw)), 'duplicate'); // Paystack retries: no double unlock
  assert.equal((await enr(e)).status, 'active');
  assert.equal(Number((await enr(e)).total_paid), 4000);
  assert.equal(await status(p.id), 'completed');
});

test('webhooks for other events, unknown references or broken bodies are acknowledged without effect', async () => {
  const { ref } = await seed();
  const other = webhook(ref, 'transfer.success');
  assert.match(await svc.handlePaystackWebhook(Buffer.from(other), sign(other)), /^ignored/);
  const unknown = webhook('NOT-OURS-123456');
  assert.equal(await svc.handlePaystackWebhook(Buffer.from(unknown), sign(unknown)), 'unknown_reference');
  assert.equal(await svc.handlePaystackWebhook(Buffer.from('not json'), sign('not json')), 'malformed');
});

test('the webhook HTTP handler: 401 for a bad signature, 200 once handled, and the event is logged', async () => {
  const { ref, e } = await seed();
  verifyResult = { status: 'success', amount: 400000, currency: 'KES' };
  const raw = webhook(ref);
  const send = (signature: string | undefined) => call(C.paystackWebhook, { body: Buffer.from(raw), ip: '1.2.3.4', header: (h: string) => (h === 'x-paystack-signature' ? signature : undefined) });
  const bad = await send('nope');
  assert.equal(bad.status, 401);
  const good = await send(sign(raw));
  assert.equal(good.status, 200);
  assert.equal((await enr(e)).status, 'active');
  const log = (await db.query(`SELECT outcome FROM payment_events WHERE source = 'paystack_webhook' ORDER BY created_at`)).rows.map((r: any) => r.outcome);
  assert.ok(log.includes('bad_signature') && log.includes('completed'));
});

// ── starting a payment ───────────────────────────────────────────────────────

test('starting a payment: the amount comes from the enrollment, not from the request, and Paystack gets KES in subunits', async () => {
  const { u, e } = await seed({ fee: 4000 });
  initCalls = [];
  const r = await call(C.initializePaystack, asParent(u, { body: { enrollment_id: e, amount: 1, fee_amount: 1 } }));
  assert.equal(r.error, null);
  assert.equal(r.status, 200);
  assert.match(r.body.data.authorization_url, /^https:\/\/checkout\.paystack\.com\//);
  assert.equal(initCalls.length, 1);
  assert.equal(initCalls[0].amountKes, 4000); // not the 1 the browser claimed
  assert.equal(initCalls[0].reference, r.body.data.reference);
  assert.equal(initCalls[0].callbackUrl.endsWith('/parent/programs'), true);
  const row = (await db.query('SELECT amount, method, source, status, paystack_reference FROM payments WHERE paystack_reference = $1', [r.body.data.reference])).rows[0];
  assert.equal(Number(row.amount), 4000);
  assert.equal(row.method, 'Paystack');
  assert.equal(row.status, 'pending');
});

test('starting a payment: a parent without an email still gets a valid payer email, and cannot pay for someone else\'s enrollment', async () => {
  const noEmail = await seed({ email: null });
  initCalls = [];
  const ok = await call(C.initializePaystack, asParent(noEmail.u, { body: { enrollment_id: noEmail.e } }));
  assert.equal(ok.error, null);
  assert.match(initCalls[0].email, /^parent-[0-9a-f]{8}@[^@]+$/);

  const mine = await seed();
  const stranger = await seed();
  const denied = await call(C.initializePaystack, asParent(stranger.u, { body: { enrollment_id: mine.e } }));
  assert.equal(denied.error?.statusCode, 404);
});

test('starting a payment again replaces the unfinished page; and if Paystack cannot start it the payment is marked failed', async () => {
  const { u, e } = await seed();
  const first = await call(C.initializePaystack, asParent(u, { body: { enrollment_id: e } }));
  const second = await call(C.initializePaystack, asParent(u, { body: { enrollment_id: e } }));
  assert.notEqual(first.body.data.reference, second.body.data.reference);
  const rows = (await db.query(`SELECT paystack_reference, status FROM payments WHERE enrollment_id = $1 ORDER BY created_at`, [e])).rows;
  assert.equal(rows.filter((r: any) => r.status === 'pending').length, 1); // only the newest page is live
  assert.equal(rows.find((r: any) => r.paystack_reference === first.body.data.reference).status, 'expired');

  initFails = true;
  const down = await call(C.initializePaystack, asParent(u, { body: { enrollment_id: e } }));
  initFails = false;
  assert.equal(down.error?.statusCode, 502);
  assert.equal((await db.query(`SELECT status FROM payments WHERE enrollment_id = $1 ORDER BY created_at DESC LIMIT 1`, [e])).rows[0].status, 'failed');
  assert.equal((await enr(e)).status, 'pending'); // nothing unlocked
});

// ── coming back from Paystack ────────────────────────────────────────────────

test('the return page can only look at the parent\'s own payments, and asks Paystack for the truth', async () => {
  const { u, ref, e } = await seed();
  const other = await seed();
  verifyResult = { status: 'success', amount: 400000, currency: 'KES' };
  const denied = await call(C.verifyPaystack, asParent(other.u, { params: { reference: ref } }));
  assert.equal(denied.error?.statusCode, 404);
  assert.equal((await enr(e)).status, 'pending');
  const ok = await call(C.verifyPaystack, asParent(u, { params: { reference: ref } }));
  assert.equal(ok.body.data.payment_status, 'completed');
  assert.equal(ok.body.data.enrollment_status, 'active');
});

// ── the background job ───────────────────────────────────────────────────────

test('the background job settles Paystack payments the webhook never reached us for', async () => {
  const { p, e } = await seed();
  await backdate(p.id, 5);
  verifyResult = { status: 'success', amount: 400000, currency: 'KES' };
  const count = await svc.reconcilePendingPayments();
  assert.ok(count >= 1);
  assert.equal(await status(p.id), 'completed');
  assert.equal((await enr(e)).status, 'active');
});

test('polling is gentle: asking again straight away does not call Paystack twice', async () => {
  const { p } = await seed();
  verifyResult = { status: 'abandoned', amount: 400000, currency: 'KES' };
  const before = verifyCalls;
  await svc.verifyAndApplyPaystackThrottled(p);
  await svc.verifyAndApplyPaystackThrottled(p);
  await svc.verifyAndApplyPaystackThrottled(p);
  assert.equal(verifyCalls - before, 1);
});
