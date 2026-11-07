import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import env from '../config/env';
import { AppError } from '../utils/appError';
import { initializeTransaction, isPaystackEnabled } from '../utils/paystack';
import {
  handlePaystackWebhook,
  logPaymentEvent,
  markFailed,
  verifyAndApplyPaystackThrottled,
} from '../services/paymentService';

// ─── Is card payment switched on? (the website hides the option when it is not) ───

export const paystackEnabled = (_req: Request, res: Response) => {
  res.status(200).json({ status: 'success', data: { enabled: isPaystackEnabled() } });
};

// ─── Start a payment: returns the Paystack page the parent is sent to ────────────

/** Paystack needs an email. Parents who signed up with a phone number have none, so we use a stand-in on our own domain. */
const payerEmail = (parentEmail: string | null, parentId: string) => {
  if (parentEmail) return parentEmail;
  let host = 'akilicode.com';
  try {
    host = new URL(env.FRONTEND_URL).hostname;
  } catch {
    /* keep the default */
  }
  return `parent-${parentId.slice(0, 8)}@${host}`;
};

export const initializePaystack = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = req.user?.id;
    if (!parentId) return next(new AppError('Unauthorized access.', 401));
    if (!isPaystackEnabled()) return next(new AppError('Card payments are not available right now. Please use M-Pesa.', 503));

    const { enrollment_id } = req.body as { enrollment_id: string };

    const found = await pool.query(
      `SELECT e.id, e.kid_id, e.course_name, e.fee_amount, k.name AS kid_name, u.email AS parent_email
         FROM enrollments e
         JOIN kids k ON e.kid_id = k.id
         JOIN users u ON u.id = e.parent_id
        WHERE e.id = $1 AND e.parent_id = $2 AND e.status IN ('pending', 'active')`,
      [enrollment_id, parentId]
    );
    if (found.rows.length === 0) return next(new AppError('Enrollment not found or does not belong to you.', 404));
    const enrollment = found.rows[0];

    // The amount comes from our database, never from the browser.
    const amount = Number(enrollment.fee_amount);
    if (!Number.isFinite(amount) || amount < 1) return next(new AppError('This enrollment has no amount due.', 400));

    // A new payment page replaces any earlier unfinished one for this enrollment (the old one can still be settled if paid).
    await pool.query(
      `UPDATE payments SET status = 'expired', result_desc = 'replaced by a newer payment page'
        WHERE enrollment_id = $1 AND source = 'paystack' AND status = 'pending'`,
      [enrollment_id]
    );

    const reference = `AK${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`.toUpperCase();
    const description = `Fee for ${enrollment.kid_name} — ${enrollment.course_name}`;
    const ins = await pool.query(
      `INSERT INTO payments
         (enrollment_id, kid_id, parent_id, amount, method, reference, description, receipt_number,
          status, date, source, paystack_reference)
       VALUES ($1,$2,$3,$4,'Paystack',$5,$6,$7,'pending',now(),'paystack',$5)
       RETURNING id`,
      [enrollment_id, enrollment.kid_id, parentId, amount, reference, description, `RCP-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`]
    );
    const paymentId: string = ins.rows[0].id;

    try {
      const init = await initializeTransaction({
        email: payerEmail(enrollment.parent_email, parentId),
        amountKes: amount,
        reference,
        callbackUrl: `${env.FRONTEND_URL}/parent/programs`,
        metadata: { enrollment_id, payment_id: paymentId, kid: enrollment.kid_name, course: enrollment.course_name },
      });
      await logPaymentEvent({ source: 'paystack_init', outcome: 'ok', checkoutRequestId: reference });
      return res.status(200).json({
        status: 'success',
        message: 'Opening the secure payment page…',
        data: { authorization_url: init.authorization_url, reference },
      });
    } catch (err: any) {
      const detail = err?.response?.data?.message ?? err?.message ?? 'unknown error';
      console.error('Paystack initialize failed:', detail);
      await markFailed(paymentId, null, 'Could not start the Paystack payment');
      await logPaymentEvent({ source: 'paystack_init', outcome: `error ${err?.response?.status ?? 'none'}`, checkoutRequestId: reference, payload: { detail } });
      return next(new AppError('Could not open the payment page. Please try again, or use M-Pesa.', 502));
    }
  } catch (error) {
    next(error);
  }
};

// ─── The parent comes back from Paystack (or the page asks again) ────────────────
// Never trusts the browser: the server asks Paystack itself.

export const verifyPaystack = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = req.user?.id;
    if (!parentId) return next(new AppError('Unauthorized access.', 401));
    const reference = String(req.params.reference);

    // Only the parent's own payments can be looked at.
    const found = await pool.query(`SELECT * FROM payments WHERE paystack_reference = $1 AND parent_id = $2 AND source = 'paystack'`, [reference, parentId]);
    let payment = found.rows[0];
    if (!payment) return next(new AppError('Payment not found.', 404));

    if (['pending', 'expired', 'failed'].includes(payment.status)) {
      await verifyAndApplyPaystackThrottled(payment);
      const refreshed = await pool.query('SELECT status, result_desc FROM payments WHERE id = $1', [payment.id]);
      payment = { ...payment, status: refreshed.rows[0]?.status ?? payment.status, result_desc: refreshed.rows[0]?.result_desc ?? payment.result_desc };
    }
    const enr = await pool.query('SELECT status FROM enrollments WHERE id = $1 AND parent_id = $2', [payment.enrollment_id, parentId]);

    res.status(200).json({
      status: 'success',
      data: {
        payment_status: payment.status,
        enrollment_id: payment.enrollment_id,
        enrollment_status: enr.rows[0]?.status,
        ...(payment.status === 'failed' || payment.status === 'expired'
          ? { reason: payment.result_desc ? `The payment did not go through (${payment.result_desc}).` : 'The payment did not go through.' }
          : {}),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── Paystack -> us ──────────────────────────────────────────────────────────────
// The body arrives raw (see app.ts): the signature is computed over the exact bytes.

export const paystackWebhook = async (req: Request, res: Response) => {
  const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
  let outcome = 'error';
  try {
    outcome = await handlePaystackWebhook(raw, req.header('x-paystack-signature'));
  } catch (error) {
    console.error('Paystack webhook error:', (error as Error).message);
  }

  let payload: unknown = null;
  if (outcome !== 'bad_signature') {
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      /* not JSON: nothing to keep */
    }
  }
  await logPaymentEvent({ source: 'paystack_webhook', outcome: outcome.slice(0, 40), ip: req.ip, payload });

  // Not from Paystack: refuse. A genuine webhook we could not process (a hiccup) gets a 5xx so Paystack tries again.
  if (outcome === 'bad_signature') return res.status(401).json({ status: 'fail', message: 'Invalid signature' });
  if (outcome === 'error') return res.status(500).json({ status: 'error' });
  return res.status(200).json({ status: 'success' });
};
