/**
 * Runs the REAL payment SQL against an in-process Postgres (pglite) loaded from
 * schema/schema.sql + migrations/001. Nothing here touches the live database.
 */
import './setup';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

let db: any;
let svc: typeof import('../src/services/paymentService');
let stkResult: any = { ResultCode: '0' };
let stkCalls = 0;

const fakeModule = (file: string, exports: any) => {
  const id = require.resolve(file);
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] } as any;
};

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { uuid_ossp } = await import('@electric-sql/pglite/contrib/uuid_ossp');
  db = new PGlite({ extensions: { uuid_ossp } });

  const root = path.join(__dirname, '..');
  const schema = fs
    .readFileSync(path.join(root, 'schema/schema.sql'), 'utf8')
    .replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/, '')
    .replace(/CREATE EXTENSION IF NOT EXISTS "uuid-ossp";/, 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
  await db.exec(schema);
  await db.exec(fs.readFileSync(path.join(root, 'migrations/001_payment_hardening.sql'), 'utf8'));

  const run = async (sql: string, params?: any[]) => {
    const r = await db.query(sql, params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  const pool = { query: run, connect: async () => ({ query: run, release() {} }), on() {} };
  fakeModule('../src/config/db', { __esModule: true, default: pool, query: run });
  fakeModule('../src/utils/mpesa', {
    querySTKStatus: async () => { stkCalls++; if (stkResult instanceof Error) throw stkResult; return stkResult; },
  });
  fakeModule('../src/utils/mailsTemplate', { sendReceiptEmail: async () => {} });

  svc = require('../src/services/paymentService');
});

let n = 0;
const seed = async (opts: { fee?: number; phone?: string } = {}) => {
  n++;
  const msisdn = `2547${10000000 + n}`;
  const u = (await db.query(
    `INSERT INTO users (name,email,phone,password,is_verified) VALUES ('P','p${n}@x.co',$1,'x',true) RETURNING id`,
    [opts.phone ?? `07${10000000 + n}`])).rows[0].id;
  const k = (await db.query(`INSERT INTO kids (parent_id,name,age) VALUES ($1,'K',8) RETURNING id`, [u])).rows[0].id;
  const e = (await db.query(
    `INSERT INTO enrollments (kid_id,parent_id,course_name,fee_amount,billing_cycle,status)
     VALUES ($1,$2,'Course',$3,'monthly','pending') RETURNING id`, [k, u, opts.fee ?? 4000])).rows[0].id;
  const checkout = `ws_CO_${n}`;
  const p = (await db.query(
    `INSERT INTO payments (enrollment_id,kid_id,parent_id,amount,method,reference,receipt_number,status,
        checkout_request_id,phone,source)
     VALUES ($1,$2,$3,$4,'M-Pesa',$5,$6,'pending',$5,'254712345678','stk') RETURNING *`,
    [e, k, u, opts.fee ?? 4000, checkout, `RCP-${n}`])).rows[0];
  return { u, k, e, p, msisdn };
};
const items = (o: Record<string, string | number>) => Object.entries(o).map(([Name, Value]) => ({ Name, Value }));
const status = async (id: string) => (await db.query('SELECT status FROM payments WHERE id=$1', [id])).rows[0].status;
const enr = async (id: string) => (await db.query('SELECT * FROM enrollments WHERE id=$1', [id])).rows[0];

test('success confirmed by Safaricom unlocks the enrollment exactly once', async () => {
  const { p, e } = await seed();
  stkResult = { ResultCode: '0' };
  const good = items({ Amount: 4000, PhoneNumber: 254712345678, MpesaReceiptNumber: 'RCP1ABC234' });
  assert.equal(await svc.verifyAndApplyStk(p, good), 'completed');
  assert.equal(await svc.verifyAndApplyStk(p, good), 'duplicate'); // replay: no second unlock
  const row = await enr(e);
  assert.equal(row.status, 'active');
  assert.equal(row.payment_status, 'paid');
  assert.equal(Number(row.total_paid), 4000); // counted once, not twice
  assert.equal(await status(p.id), 'completed');
});

test('callback saying success is NOT enough if Safaricom says it failed', async () => {
  const { p, e } = await seed();
  stkResult = { ResultCode: '1032', ResultDesc: 'Request cancelled by user' };
  assert.equal(await svc.verifyAndApplyStk(p, items({ Amount: 4000, MpesaReceiptNumber: 'FAKE000001' })), 'failed');
  assert.equal(await status(p.id), 'failed');
  assert.equal((await enr(e)).payment_status, 'pending');
});

test('amount mismatch goes to review and unlocks nothing', async () => {
  const { p, e } = await seed();
  stkResult = { ResultCode: '0' };
  assert.equal(await svc.verifyAndApplyStk(p, items({ Amount: 10, PhoneNumber: 254712345678 })), 'review');
  assert.equal(await status(p.id), 'review');
  assert.equal((await enr(e)).payment_status, 'pending');
});

test('phone mismatch goes to review', async () => {
  const { p } = await seed();
  stkResult = { ResultCode: '0' };
  assert.equal(await svc.verifyAndApplyStk(p, items({ Amount: 4000, PhoneNumber: 254799999999 })), 'review');
});

test('Safaricom still processing -> stays pending; never guesses', async () => {
  const { p } = await seed();
  stkResult = new Error('still processing');
  assert.equal(await svc.verifyAndApplyStk(p), 'pending');
  assert.equal(await status(p.id), 'pending');
});

test('no answer after 10 minutes -> expired, and a late success can still settle it', async () => {
  const { p, e } = await seed();
  await db.query(`UPDATE payments SET created_at = now() - interval '11 minutes' WHERE id=$1`, [p.id]);
  const old = (await db.query('SELECT * FROM payments WHERE id=$1', [p.id])).rows[0];
  stkResult = new Error('still processing');
  assert.equal(await svc.verifyAndApplyStk(old), 'expired');
  stkResult = { ResultCode: '0' };
  const expired = (await db.query('SELECT * FROM payments WHERE id=$1', [p.id])).rows[0];
  assert.equal(await svc.verifyAndApplyStk(expired), 'completed');
  assert.equal((await enr(e)).payment_status, 'paid');
});

test('the same M-Pesa receipt cannot be recorded for two payments', async () => {
  const a = await seed();
  const b = await seed();
  stkResult = { ResultCode: '0' };
  const it = (r: string) => items({ Amount: 4000, PhoneNumber: 254712345678, MpesaReceiptNumber: r });
  assert.equal(await svc.verifyAndApplyStk(a.p, it('SAMERCPT01')), 'completed');
  assert.equal(await svc.verifyAndApplyStk(b.p, it('SAMERCPT01')), 'duplicate'); // unique index blocks it
  assert.equal((await enr(b.e)).payment_status, 'pending');
});

test('C2B: auto-confirm is OFF by default, so even a perfect match waits for an admin', async () => {
  const { e, p, msisdn } = await seed({ fee: 2500 });
  const out = await svc.handleC2bConfirmation({
    TransID: 'C2BTEST0001', TransAmount: '2500', MSISDN: msisdn, BillRefNumber: e, BusinessShortCode: '174379',
  });
  assert.equal(out, 'review');
  const row = (await db.query(`SELECT id,status FROM payments WHERE mpesa_receipt='C2BTEST0001'`)).rows[0];
  assert.equal(row.status, 'review');
  assert.equal((await enr(e)).payment_status, 'pending');
  // admin approves -> unlocked; approving again does nothing
  assert.equal(await svc.resolveReview(row.id, true), true);
  assert.equal(await svc.resolveReview(row.id, true), false);
  assert.equal((await enr(e)).payment_status, 'paid');
  void p;
});

test('C2B: duplicate TransID, wrong shortcode and unknown reference are all ignored', async () => {
  const { e, msisdn } = await seed({ fee: 2500 });
  const base = { TransAmount: '2500', MSISDN: msisdn, BillRefNumber: e, BusinessShortCode: '174379' };
  assert.equal(await svc.handleC2bConfirmation({ ...base, TransID: 'C2BTEST0002' }), 'review');
  assert.equal(await svc.handleC2bConfirmation({ ...base, TransID: 'C2BTEST0002' }), 'duplicate');
  assert.equal(await svc.handleC2bConfirmation({ ...base, TransID: 'C2BTEST0003', BusinessShortCode: '999999' }), 'wrong_shortcode');
  assert.equal(await svc.handleC2bConfirmation({ ...base, TransID: 'C2BTEST0004', BillRefNumber: 'not-a-uuid' }), 'unmatched_reference');
  assert.equal(await svc.handleC2bConfirmation({ ...base, TransID: 'C2BTEST0005', BillRefNumber: '6f1c2f4e-8a3b-4c1d-9e2f-1a2b3c4d5e6f' }), 'unmatched_reference');
});

test('payment_events log accepts entries', async () => {
  await svc.logPaymentEvent({ source: 'stk_callback', outcome: 'unit_test', checkoutRequestId: 'x', payload: { a: 1 } });
  const r = await db.query(`SELECT count(*)::int AS c FROM payment_events WHERE outcome='unit_test'`);
  assert.equal(r.rows[0].c, 1);
  assert.ok(stkCalls > 0);
});

test('ResultCode 4999 ("still under processing") is NOT a failure', async () => {
  const { p } = await seed();
  stkResult = { ResultCode: '4999', ResultDesc: 'The transaction is still under processing' };
  assert.equal(await svc.verifyAndApplyStk(p), 'pending');
  assert.equal(await status(p.id), 'pending');
});

test('a payment wrongly marked failed is corrected when Safaricom later confirms success', async () => {
  const { p, e } = await seed();
  stkResult = { ResultCode: '1032', ResultDesc: 'Request cancelled by user' };
  assert.equal(await svc.verifyAndApplyStk(p), 'failed');
  stkResult = { ResultCode: '0' };
  const failed = (await db.query('SELECT * FROM payments WHERE id=$1', [p.id])).rows[0];
  assert.equal(await svc.verifyAndApplyStk(failed), 'completed');
  assert.equal((await enr(e)).payment_status, 'paid');
});
