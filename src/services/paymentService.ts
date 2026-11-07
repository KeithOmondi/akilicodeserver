import { PoolClient } from 'pg';
import pool from '../config/db';
import env from '../config/env';
import { querySTKStatus } from '../utils/mpesa';
import { sendReceiptEmail } from '../utils/mailsTemplate';
import { calculateNextPaymentDate } from '../utils/paymentSchedule';
import { normalizeKenyanPhone } from '../validators/common';

/**
 * The ONLY place a payment is allowed to become "completed".
 *
 * Trust model (Daraja callbacks are not signed):
 *  1. The callback URL contains a secret path segment (checked in the route).
 *  2. A callback is only a *hint*. We act only on a CheckoutRequestID that we
 *     created ourselves and stored as pending/expired.
 *  3. Before unlocking anything we ask Safaricom directly (STK Push Query).
 *  4. When the callback carries Amount / PhoneNumber they must match our record.
 *  5. The UPDATE ... WHERE status IN (...) RETURNING makes this idempotent:
 *     only one caller can win the transition, so nothing unlocks twice.
 *     A unique index on mpesa_receipt backs this up in the database.
 */

export type PaymentRow = {
  id: string;
  enrollment_id: string;
  kid_id: string;
  parent_id: string;
  amount: string;
  phone: string | null;
  status: string;
  checkout_request_id: string | null;
  created_at: Date;
};

export type PaymentOutcome = 'completed' | 'failed' | 'pending' | 'review' | 'expired' | 'duplicate' | 'unknown';

const PENDING_TIMEOUT_MS = 10 * 60 * 1000;

// ─── Pure decision logic (unit-tested) ───────────────────────────────────────

export type CallbackItems = { Name: string; Value?: string | number }[];

export const readItem = (items: CallbackItems | undefined, name: string) =>
  items?.find((i) => i.Name === name)?.Value;

/**
 * Compare what Safaricom reports in the callback against our pending record.
 * Returns a reason string if something does not match, otherwise null.
 */
export const findCallbackMismatch = (
  payment: Pick<PaymentRow, 'amount' | 'phone'>,
  items: CallbackItems | undefined
): string | null => {
  if (!items) return null; // nothing to compare (e.g. status poll); Query API still confirmed it

  const amount = Number(readItem(items, 'Amount'));
  if (!Number.isFinite(amount) || Math.abs(amount - Math.round(Number(payment.amount))) > 0.001) {
    return `amount mismatch: expected ${Math.round(Number(payment.amount))}, got ${readItem(items, 'Amount')}`;
  }

  const rawPhone = String(readItem(items, 'PhoneNumber') ?? '');
  // Safaricom may mask or hash the number; only compare when it is a plain MSISDN.
  if (/^\d{12}$/.test(rawPhone) && payment.phone && rawPhone !== payment.phone) {
    return 'phone mismatch';
  }
  return null;
};

/**
 * Decided in SQL on purpose. payments.created_at is "timestamp without time zone",
 * which the Node driver reads as *local* time; comparing it in JavaScript would be
 * wrong by hours whenever the server timezone differs from the database's.
 */
const hasTimedOut = async (paymentId: string): Promise<boolean> => {
  const { rows } = await pool.query(
    `SELECT created_at < now() - ($2 || ' milliseconds')::interval AS timed_out FROM payments WHERE id = $1`,
    [paymentId, String(PENDING_TIMEOUT_MS)]
  );
  return rows[0]?.timed_out === true;
};

// ─── Event log ───────────────────────────────────────────────────────────────

export const logPaymentEvent = async (e: {
  source: 'stk_callback' | 'c2b_confirm' | 'c2b_validate' | 'stk_query';
  outcome: string;
  ip?: string;
  checkoutRequestId?: string | null;
  mpesaReceipt?: string | null;
  payload?: unknown;
}) => {
  try {
    await pool.query(
      `INSERT INTO payment_events (source, outcome, ip, checkout_request_id, mpesa_receipt, payload)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        e.source,
        e.outcome,
        e.ip?.slice(0, 64) ?? null,
        e.checkoutRequestId ?? null,
        e.mpesaReceipt ?? null,
        e.payload === undefined ? null : JSON.stringify(e.payload).slice(0, 20000),
      ]
    );
  } catch (err) {
    // Logging must never break payment processing.
    console.error('payment_events insert failed:', (err as Error).message);
  }
};

// ─── State transitions ───────────────────────────────────────────────────────

const applyEnrollmentPaid = async (client: PoolClient, payment: PaymentRow, receipt: string | null) => {
  const { rows } = await client.query(`SELECT billing_cycle FROM enrollments WHERE id = $1 FOR UPDATE`, [
    payment.enrollment_id,
  ]);
  const billing = rows[0]?.billing_cycle;
  const next = billing ? calculateNextPaymentDate(new Date(), billing) : null;
  const status = billing === 'once-off' ? 'completed' : 'active';

  await client.query(
    `UPDATE enrollments
        SET status = $1,
            payment_status = 'paid',
            next_payment_date = $2,
            last_payment_date = now(),
            paid_at = now(),
            mpesa_receipt_number = COALESCE($3, mpesa_receipt_number),
            total_paid = COALESCE(total_paid, 0) + $4
      WHERE id = $5`,
    [status, billing === 'once-off' ? null : next, receipt, payment.amount, payment.enrollment_id]
  );
};

/** pending|expired|review -> completed. Returns false if someone else already did it. */
export const finalizeSuccess = async (
  paymentId: string,
  opts: { receipt?: string | null; allowedFrom: string[] }
): Promise<boolean> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE payments
          SET status = 'completed',
              mpesa_receipt = COALESCE($2, mpesa_receipt),
              reference = COALESCE($2, reference),
              verified_at = now(),
              result_code = 0
        WHERE id = $1 AND status = ANY($3)
      RETURNING *`,
      [paymentId, opts.receipt ?? null, opts.allowedFrom]
    );
    if (upd.rows.length === 0) {
      await client.query('ROLLBACK');
      return false; // already processed: idempotent no-op
    }
    await applyEnrollmentPaid(client, upd.rows[0], opts.receipt ?? null);
    await client.query('COMMIT');
    void sendReceipt(paymentId);
    return true;
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err?.code === '23505') return false; // unique receipt violation = already recorded
    throw err;
  } finally {
    client.release();
  }
};

export const markFailed = async (paymentId: string, code: number | null, desc: string | null, status = 'failed') => {
  const r = await pool.query(
    `UPDATE payments SET status = $4, result_code = $2, result_desc = $3
      WHERE id = $1 AND status IN ('pending','expired')`,
    [paymentId, code, desc?.slice(0, 500) ?? null, status]
  );
  return (r.rowCount ?? 0) > 0;
};

export const markReview = async (paymentId: string, reason: string) => {
  const r = await pool.query(
    `UPDATE payments SET status = 'review', review_reason = $2 WHERE id = $1 AND status IN ('pending','expired')`,
    [paymentId, reason.slice(0, 500)]
  );
  return (r.rowCount ?? 0) > 0;
};

const sendReceipt = async (paymentId: string) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, k.name AS kid_name, e.course_name, u.name AS parent_name, u.email AS parent_email
         FROM payments p
         JOIN kids k ON p.kid_id = k.id
         JOIN enrollments e ON p.enrollment_id = e.id
         JOIN users u ON p.parent_id = u.id
        WHERE p.id = $1`,
      [paymentId]
    );
    const r = rows[0];
    if (!r) return;
    await sendReceiptEmail({
      email: r.parent_email,
      parent_name: r.parent_name,
      kid_name: r.kid_name,
      course_name: r.course_name,
      amount: r.amount,
      method: 'M-Pesa',
      reference: r.mpesa_receipt ?? r.reference,
      date: r.date,
      description: r.description,
      receipt_number: r.receipt_number,
      status: 'completed',
    });
  } catch (err) {
    console.error('Receipt email failed:', (err as Error).message);
  }
};

// ─── STK: confirm with Safaricom, then apply ─────────────────────────────────

/**
 * Ask Safaricom for the real result of this payment and apply it.
 * `callbackItems` is passed when triggered by a callback so amount/phone are checked.
 */
const STILL_PROCESSING = 4999;

export const verifyAndApplyStk = async (
  payment: PaymentRow,
  callbackItems?: CallbackItems
): Promise<PaymentOutcome> => {
  if (!payment.checkout_request_id) return 'unknown';

  let result: any;
  try {
    result = await querySTKStatus(payment.checkout_request_id);
  } catch {
    // Safaricom: still processing, or temporarily unreachable. Never guess.
    if (await hasTimedOut(payment.id)) {
      await markFailed(payment.id, null, 'No confirmation from Safaricom within 10 minutes', 'expired');
      return 'expired';
    }
    return 'pending';
  }

  await logPaymentEvent({
    source: 'stk_query',
    outcome: `ResultCode ${result?.ResultCode}`,
    checkoutRequestId: payment.checkout_request_id,
    payload: result,
  });

  const code = Number(result?.ResultCode);
  if (!Number.isFinite(code)) return 'pending';

  // 4999 = "the transaction is still under processing". It is NOT a failure: the customer may not have typed the PIN yet.
  if (code === STILL_PROCESSING) {
    if (await hasTimedOut(payment.id)) {
      await markFailed(payment.id, null, 'No confirmation from Safaricom within 10 minutes', 'expired');
      return 'expired';
    }
    return 'pending';
  }

  if (code !== 0) {
    await markFailed(payment.id, code, String(result?.ResultDesc ?? ''));
    return 'failed';
  }

  // Safaricom confirms success. Now check the details we were given.
  const mismatch = findCallbackMismatch(payment, callbackItems);
  if (mismatch) {
    await markReview(payment.id, mismatch);
    return 'review';
  }

  const receipt = callbackItems ? String(readItem(callbackItems, 'MpesaReceiptNumber') ?? '') || null : null;
  // Safaricom itself just confirmed success, so this may also correct a payment we wrongly marked failed earlier.
  const won = await finalizeSuccess(payment.id, { receipt, allowedFrom: ['pending', 'expired', 'failed'] });
  return won ? 'completed' : 'duplicate';
};

export const findPaymentByCheckoutId = async (checkoutId: string): Promise<PaymentRow | null> => {
  const { rows } = await pool.query(
    `SELECT * FROM payments WHERE checkout_request_id = $1 AND method = 'M-Pesa' AND source = 'stk'`,
    [checkoutId]
  );
  return rows[0] ?? null;
};

/** Called by a cron job: settle any STK payments the callback never reached us for. */
let reconcileDisabled = false;

export const reconcilePendingPayments = async () => {
  if (reconcileDisabled) return 0;
  let rows: any[];
  try {
    ({ rows } = await pool.query(
    `SELECT * FROM payments
      WHERE (status = 'pending' OR (status = 'failed' AND created_at > now() - interval '30 minutes'))
        AND source = 'stk' AND checkout_request_id IS NOT NULL
        AND created_at < now() - interval '45 seconds'
        AND created_at > now() - interval '2 days'
      ORDER BY created_at LIMIT 100`
    ));
  } catch (err: any) {
    if (err?.code === '42703' || err?.code === '42P01') {
      // The database has not been migrated yet (columns/tables from migration 001 are missing).
      reconcileDisabled = true;
      console.warn('⚠️  Payment reconcile job is OFF: the database is missing migration 001. Run "npm run migrate:main" (or :branch), then restart.');
      return 0;
    }
    throw err;
  }
  for (const p of rows) {
    await verifyAndApplyStk(p).catch((e) => console.error('reconcile failed:', p.id, e.message));
  }
  return rows.length;
};

// ─── C2B (Paybill paid directly, no STK request on our side) ─────────────────

export type C2BBody = {
  TransID?: string;
  TransAmount?: string | number;
  MSISDN?: string | number;
  BillRefNumber?: string;
  BusinessShortCode?: string | number;
  FirstName?: string;
  LastName?: string;
};

const PAY_REF_RE = /^AK[A-Z0-9]{6}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * C2B has no CheckoutRequestID and no Query API, so the strongest rules available are:
 *  - TransID must be new (unique index), shortcode must be ours
 *  - BillRefNumber must be a real enrollment that is awaiting payment
 *  - amount must equal what the enrollment owes
 *  - MSISDN must be the parent's registered phone
 * Anything less than a perfect match is stored as 'review' for an admin.
 * Even a perfect match only unlocks automatically if MPESA_C2B_AUTO_CONFIRM=true.
 */
export const handleC2bConfirmation = async (body: C2BBody): Promise<string> => {
  const transId = String(body.TransID ?? '').trim();
  const shortcode = String(body.BusinessShortCode ?? '');
  if (!/^[A-Z0-9]{8,15}$/.test(transId)) return 'invalid_trans_id';
  if (shortcode !== String(env.MPESA_SHORTCODE)) return 'wrong_shortcode';

  const amount = Number(body.TransAmount);
  const ref = String(body.BillRefNumber ?? '').trim();
  if (!Number.isFinite(amount) || amount <= 0) return 'invalid_amount';
  // Customers type the account number by hand: tolerate spaces and lower case.
  const cleanRef = ref.replace(/[\s-]/g, '').toUpperCase();
  const byPayRef = PAY_REF_RE.test(cleanRef);
  if (!byPayRef && !UUID_RE.test(ref)) return 'unmatched_reference';

  const enr = await pool.query(
    `SELECT e.id, e.kid_id, e.parent_id, e.fee_amount, e.course_name, u.phone AS parent_phone
       FROM enrollments e JOIN users u ON u.id = e.parent_id
      WHERE ${byPayRef ? 'e.pay_ref = $1' : 'e.id = $1'} AND e.status IN ('pending','active')`,
    [byPayRef ? cleanRef : ref]
  );
  if (enr.rows.length === 0) return 'unmatched_reference';
  const e = enr.rows[0];

  const msisdn = String(body.MSISDN ?? '');
  const parentPhone = normalizeKenyanPhone(e.parent_phone ?? '');
  const amountOk = Math.abs(amount - Number(e.fee_amount)) < 0.01;
  const phoneOk = /^\d{12}$/.test(msisdn) && !!parentPhone && msisdn === parentPhone;

  const reasons: string[] = [];
  if (!amountOk) reasons.push(`amount ${amount} != owed ${e.fee_amount}`);
  if (!phoneOk) reasons.push('sender phone differs from parent phone (or is masked)');
  if (!env.MPESA_C2B_AUTO_CONFIRM) reasons.push('auto-confirm disabled: needs admin approval');

  const ins = await pool.query(
    `INSERT INTO payments
       (enrollment_id, kid_id, parent_id, amount, method, reference, description, receipt_number,
        status, date, mpesa_receipt, source, phone, review_reason)
     VALUES ($1,$2,$3,$4,'M-Pesa',$5,$6,$7,'review',now(),$5,'c2b',$8,$9)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      e.id, e.kid_id, e.parent_id, amount, transId,
      `Paybill payment — ${e.course_name}`,
      `RCP-${Date.now()}-${transId.slice(-4)}`,
      /^\d{12}$/.test(msisdn) ? msisdn : null,
      reasons.join('; ') || null,
    ]
  );
  if (ins.rows.length === 0) return 'duplicate';

  if (reasons.length === 0) {
    const won = await finalizeSuccess(ins.rows[0].id, { receipt: transId, allowedFrom: ['review'] });
    return won ? 'completed' : 'duplicate';
  }
  return 'review';
};

/** Admin decision on a payment parked for review. */
export const resolveReview = async (paymentId: string, approve: boolean): Promise<boolean> => {
  if (approve) {
    const { rows } = await pool.query(`SELECT mpesa_receipt FROM payments WHERE id = $1 AND status = 'review'`, [paymentId]);
    if (!rows[0]) return false;
    return finalizeSuccess(paymentId, { receipt: rows[0].mpesa_receipt, allowedFrom: ['review'] });
  }
  const r = await pool.query(`UPDATE payments SET status = 'failed', result_desc = 'rejected by admin' WHERE id = $1 AND status = 'review'`, [paymentId]);
  return (r.rowCount ?? 0) > 0;
};
