import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import env from '../config/env';
import { AppError } from '../utils/appError';
import { initiateStkPush, registerC2BUrls } from '../utils/mpesa';
import {
  findPaymentByCheckoutId,
  handleC2bConfirmation,
  logPaymentEvent,
  resolveReview,
  verifyAndApplyStk,
  verifyAndApplyStkThrottled,
  CallbackItems,
} from '../services/paymentService';

const ACK = { ResultCode: 0, ResultDesc: 'Accepted' };

// ─── Webhook guards ──────────────────────────────────────────────────────────

const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

/**
 * Guard for every Safaricom-facing route:
 *  - secret path segment must match (otherwise act as if the route does not exist)
 *  - optional source-IP allow-list (MPESA_ALLOWED_IPS)
 */
export const mpesaWebhookGuard =
  (source: 'stk_callback' | 'c2b_confirm' | 'c2b_validate') =>
  async (req: Request, res: Response, next: NextFunction) => {
    const secret = String(req.params.secret ?? '');
    if (!safeEqual(secret, env.MPESA_CALLBACK_SECRET)) {
      void logPaymentEvent({ source, outcome: 'bad_secret', ip: req.ip });
      return res.status(404).json({ status: 'fail', message: 'Not found' });
    }
    if (env.MPESA_ALLOWED_IPS.length > 0) {
      const ip = (req.ip ?? '').replace(/^::ffff:/, '');
      if (!env.MPESA_ALLOWED_IPS.includes(ip)) {
        void logPaymentEvent({ source, outcome: 'ip_blocked', ip: req.ip, payload: req.body });
        return res.status(403).json({ status: 'fail', message: 'Forbidden' });
      }
    }
    next();
  };

// ─── STK PUSH (parent starts a payment) ──────────────────────────────────────

export const stkPush = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = req.user?.id;
    if (!parentId) return next(new AppError('Unauthorized access.', 401));

    // Body is validated: { enrollment_id, phone } — the amount is NOT taken from the browser.
    const { enrollment_id, phone } = req.body as { enrollment_id: string; phone: string };

    const enrollmentCheck = await pool.query(
      `SELECT e.id, e.kid_id, e.course_name, e.fee_amount, e.payment_status, e.pay_ref, k.name AS kid_name
         FROM enrollments e
         JOIN kids k ON e.kid_id = k.id
        WHERE e.id = $1 AND e.parent_id = $2 AND e.status IN ('pending', 'active')`,
      [enrollment_id, parentId]
    );
    if (enrollmentCheck.rows.length === 0) {
      return next(new AppError('Enrollment not found or does not belong to you.', 404));
    }
    const enrollment = enrollmentCheck.rows[0];

    const amount = Number(enrollment.fee_amount);
    if (!Number.isFinite(amount) || amount < 1) {
      return next(new AppError('This enrollment has no amount due.', 400));
    }

    // One live request at a time per enrollment.
    const live = await pool.query(
      `SELECT 1 FROM payments
        WHERE enrollment_id = $1 AND status = 'pending' AND source = 'stk'
          AND created_at > now() - interval '2 minutes'`,
      [enrollment_id]
    );
    if (live.rows.length > 0) {
      return next(new AppError('A payment request is already waiting. Please check your phone.', 409));
    }

    const description = `Fee for ${enrollment.kid_name} — ${enrollment.course_name}`;
    const stk = await initiateStkPush(phone, amount, enrollment.pay_ref, 'AkiliFees');

    if (!stk?.CheckoutRequestID) {
      return next(new AppError('M-Pesa did not accept the request. Please try again.', 502));
    }

    await pool.query(
      `INSERT INTO payments
         (enrollment_id, kid_id, parent_id, amount, method, reference, description, receipt_number,
          status, date, checkout_request_id, merchant_request_id, phone, source)
       VALUES ($1,$2,$3,$4,'M-Pesa',$5,$6,$7,'pending',now(),$5,$8,$9,'stk')`,
      [
        enrollment_id,
        enrollment.kid_id,
        parentId,
        amount,
        stk.CheckoutRequestID,
        description,
        `RCP-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        stk.MerchantRequestID ?? null,
        phone,
      ]
    );

    res.status(200).json({
      status: 'success',
      message: 'Check your phone and enter your M-Pesa PIN to finish.',
      data: { amount, CheckoutRequestID: stk.CheckoutRequestID },
    });
  } catch (error: any) {
    console.error('STK Push Error:', error?.response?.data || error?.message || error);
    next(error);
  }
};

// ─── STK CALLBACK (Safaricom -> us) ──────────────────────────────────────────

export const stkCallback = async (req: Request, res: Response) => {
  const cb = req.body?.Body?.stkCallback;
  const checkoutId: string | undefined = typeof cb?.CheckoutRequestID === 'string' ? cb.CheckoutRequestID : undefined;

  try {
    if (!checkoutId) {
      await logPaymentEvent({ source: 'stk_callback', outcome: 'malformed', ip: req.ip, payload: req.body });
      return res.status(200).json(ACK);
    }

    const payment = await findPaymentByCheckoutId(checkoutId);
    if (!payment) {
      // Not a request we created: ignore, but keep the evidence.
      await logPaymentEvent({ source: 'stk_callback', outcome: 'unknown_checkout', ip: req.ip, checkoutRequestId: checkoutId, payload: req.body });
      return res.status(200).json(ACK);
    }
    if (!['pending', 'expired', 'failed'].includes(payment.status)) {
      await logPaymentEvent({ source: 'stk_callback', outcome: 'duplicate', ip: req.ip, checkoutRequestId: checkoutId, payload: req.body });
      return res.status(200).json(ACK);
    }

    const items: CallbackItems | undefined = cb?.CallbackMetadata?.Item;
    // The callback is a hint. verifyAndApplyStk asks Safaricom for the truth.
    const outcome = await verifyAndApplyStk(payment, Number(cb.ResultCode) === 0 ? items : undefined);

    await logPaymentEvent({
      source: 'stk_callback',
      outcome,
      ip: req.ip,
      checkoutRequestId: checkoutId,
      payload: req.body,
    });
  } catch (error) {
    console.error('STK callback error:', (error as Error).message);
    await logPaymentEvent({ source: 'stk_callback', outcome: 'error', ip: req.ip, checkoutRequestId: checkoutId, payload: req.body });
  }
  // Always acknowledge, otherwise Safaricom retries. The reconcile job is the safety net.
  return res.status(200).json(ACK);
};

// ─── CHECK PAYMENT STATUS (browser polls this) ───────────────────────────────
// Never trusts the browser: it asks Safaricom via verifyAndApplyStk if still pending.

export const checkPaymentStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = req.user?.id;
    if (!parentId) return next(new AppError('Unauthorized access.', 401));
    const { enrollmentId } = req.params;

    const latest = await pool.query(
      `SELECT * FROM payments
        WHERE enrollment_id = $1 AND parent_id = $2 AND method = 'M-Pesa'
        ORDER BY created_at DESC LIMIT 1`,
      [enrollmentId, parentId]
    );
    let payment = latest.rows[0];

    if (!payment) {
      return res.status(200).json({ status: 'success', data: { payment_status: 'not_found' } });
    }

    const age = Date.now() - new Date(payment.created_at).getTime();
    // A payment marked failed (30 min) or timed out (6 h) can still be corrected if Safaricom later says it went through.
    const recheck = (payment.status === 'failed' && age < 30 * 60 * 1000) || (payment.status === 'expired' && age < 6 * 3600 * 1000);
    if ((payment.status === 'pending' || recheck) && payment.source === 'stk') {
      await verifyAndApplyStkThrottled(payment);
      const refreshed = await pool.query('SELECT status, result_code FROM payments WHERE id = $1', [payment.id]);
      payment = { ...payment, status: refreshed.rows[0]?.status ?? payment.status, result_code: refreshed.rows[0]?.result_code ?? null };
    }

    const enr = await pool.query('SELECT status FROM enrollments WHERE id = $1 AND parent_id = $2', [enrollmentId, parentId]);

    // A plain-language reason for a failed request (Safaricom result codes), so the parent knows what to do next.
    const FRIENDLY: Record<number, string> = {
      1: 'The M-Pesa balance was not enough.',
      1001: 'Another M-Pesa request was in progress on that phone. Wait a minute and try again.',
      1019: 'The request expired. Please try again.',
      1025: 'The prompt could not be sent to that phone. Check the number and try again.',
      1032: 'The request was cancelled on the phone.',
      1037: 'The prompt timed out before the PIN was entered. Please try again.',
      2001: 'The M-Pesa PIN was wrong.',
    };
    const code = payment.result_code === null || payment.result_code === undefined ? null : Number(payment.result_code);

    res.status(200).json({
      status: 'success',
      data: {
        // pending | completed | failed | expired | review
        payment_status: payment.status,
        enrollment_status: enr.rows[0]?.status,
        ...(payment.status === 'failed' || payment.status === 'expired'
          ? { reason: (code !== null && FRIENDLY[code]) || 'M-Pesa did not complete the payment.', result_code: code }
          : {}),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── C2B ─────────────────────────────────────────────────────────────────────

export const c2bValidation = async (req: Request, res: Response) => {
  await logPaymentEvent({ source: 'c2b_validate', outcome: 'accepted', ip: req.ip, payload: req.body });
  res.status(200).json(ACK);
};

export const c2bConfirmation = async (req: Request, res: Response) => {
  let outcome = 'error';
  try {
    outcome = await handleC2bConfirmation(req.body ?? {});
  } catch (error) {
    console.error('C2B confirmation error:', (error as Error).message);
  }
  await logPaymentEvent({
    source: 'c2b_confirm',
    outcome,
    ip: req.ip,
    mpesaReceipt: typeof req.body?.TransID === 'string' ? req.body.TransID : null,
    payload: req.body,
  });
  res.status(200).json(ACK);
};

// ─── ADMIN ───────────────────────────────────────────────────────────────────

export const registerUrls = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await registerC2BUrls();
    res.status(200).json({ status: 'success', data: result });
  } catch (error) {
    next(error);
  }
};

export const listReviewPayments = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.amount, p.phone, p.mpesa_receipt, p.review_reason, p.created_at,
              e.course_name, k.name AS kid_name, u.name AS parent_name
         FROM payments p
         LEFT JOIN enrollments e ON e.id = p.enrollment_id
         LEFT JOIN kids k ON k.id = p.kid_id
         LEFT JOIN users u ON u.id = p.parent_id
        WHERE p.status = 'review' ORDER BY p.created_at DESC`
    );
    res.status(200).json({ status: 'success', results: rows.length, data: { payments: rows } });
  } catch (error) {
    next(error);
  }
};

export const approveReviewPayment = (approve: boolean) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ok = await resolveReview(req.params.paymentId as string, approve);
    if (!ok) return next(new AppError('Payment not found or not awaiting review.', 404));
    res.status(200).json({ status: 'success', message: approve ? 'Payment approved.' : 'Payment rejected.' });
  } catch (error) {
    next(error);
  }
};
