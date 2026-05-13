import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { AppError } from '../utils/appError';
import { IUser } from '../interfaces/user.interface';
import { initiateStkPush, registerC2BUrls, querySTKStatus } from '../utils/mpesa';
import { sendReceiptEmail } from '../utils/mailsTemplate';
import { calculateNextPaymentDate } from '../utils/paymentSchedule';

interface AuthRequest extends Request {
  user?: IUser;
}

// ─── STK PUSH ────────────────────────────────────────────────────────────────

export const stkPush = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parentId = req.user?.id;
    if (!parentId) return next(new AppError('Unauthorized access.', 401));

    const { enrollment_id, phone, amount } = req.body;

    if (!enrollment_id || !phone || !amount) {
      return next(new AppError('Please provide enrollment, phone, and amount.', 400));
    }

    const enrollmentCheck = await pool.query(
      `SELECT e.*, k.name AS kid_name
       FROM enrollments e
       JOIN kids k ON e.kid_id = k.id
       WHERE e.id = $1 AND e.parent_id = $2 AND e.status IN ('pending', 'active')`,
      [enrollment_id, parentId]
    );

    if (enrollmentCheck.rows.length === 0) {
      return next(new AppError('Enrollment not found or does not belong to you.', 404));
    }

    const enrollment = enrollmentCheck.rows[0];

    const stkResponse = await initiateStkPush(
      phone,
      amount,
      `AkiliCode-${enrollment_id}`,
      `Fee for ${enrollment.kid_name} — ${enrollment.course_name}`
    );

    await pool.query(
      `INSERT INTO payments
        (enrollment_id, kid_id, parent_id, amount, method, reference, description, receipt_number, status, date)
       VALUES ($1, $2, $3, $4, 'M-Pesa', $5, $6, $7, 'pending', NOW())`,
      [
        enrollment_id,
        enrollment.kid_id,
        parentId,
        amount,
        stkResponse.CheckoutRequestID,
        `Fee for ${enrollment.kid_name} — ${enrollment.course_name}`,
        `RCP-${Date.now()}`,
      ]
    );

    res.status(200).json({
      status: 'success',
      message: 'STK push sent. Waiting for payment confirmation.',
      data: {
        CheckoutRequestID: stkResponse.CheckoutRequestID,
        MerchantRequestID: stkResponse.MerchantRequestID,
      },
    });
  } catch (error: any) {
    console.error('STK Push Error:', error?.response?.data || error?.message || error);
    next(error);
  }
};

// ─── HELPER: update enrollment after confirmed payment ────────────────────────

const confirmEnrollmentPayment = async (client: any, enrollmentId: string) => {
  const enrollmentResult = await client.query(
    `SELECT billing_cycle FROM enrollments WHERE id = $1`,
    [enrollmentId]
  );

  const { billing_cycle } = enrollmentResult.rows[0];
  const nextPaymentDate = calculateNextPaymentDate(new Date(), billing_cycle);

  if (billing_cycle === 'once-off') {
    await client.query(
      `UPDATE enrollments
       SET status = 'completed', next_payment_date = NULL
       WHERE id = $1`,
      [enrollmentId]
    );
  } else {
    await client.query(
      `UPDATE enrollments
       SET status = 'active', next_payment_date = $1
       WHERE id = $2`,
      [nextPaymentDate, enrollmentId]
    );
  }
};

// ─── CHECK PAYMENT STATUS ─────────────────────────────────────────────────────

export const checkPaymentStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const client = await pool.connect();
  try {
    const parentId = req.user?.id;
    if (!parentId) return next(new AppError('Unauthorized access.', 401));

    const { enrollmentId } = req.params;

    const paymentResult = await client.query(
      `SELECT * FROM payments
       WHERE enrollment_id = $1 AND parent_id = $2 AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
      [enrollmentId, parentId]
    );

    if (paymentResult.rows.length === 0) {
      const enrollment = await client.query(
        `SELECT status, payment_status FROM enrollments WHERE id = $1 AND parent_id = $2`,
        [enrollmentId, parentId]
      );
      return res.status(200).json({
        status: 'success',
        data: {
          payment_status: enrollment.rows[0]?.payment_status === 'paid' ? 'completed' : 'not_found',
          enrollment_status: enrollment.rows[0]?.status,
        }
      });
    }

    const payment = paymentResult.rows[0];

    let stkResult: any;
    try {
      stkResult = await querySTKStatus(payment.reference);
    } catch {
      return res.status(200).json({
        status: 'success',
        data: { payment_status: 'pending', enrollment_status: 'pending' }
      });
    }

    const resultCode = Number(stkResult?.ResultCode);

    // ── Payment successful ──────────────────────────────────────────────────
    if (resultCode === 0) {
      await client.query('BEGIN');

      const mpesaRef = stkResult.MpesaReceiptNumber || `MPX-${Date.now()}`;

      await client.query(
        `UPDATE payments SET status = 'completed', reference = $1 WHERE id = $2`,
        [mpesaRef, payment.id]
      );

      await confirmEnrollmentPayment(client, payment.enrollment_id); // ✅ was missing

      await client.query('COMMIT');

      const receiptData = await client.query(
        `SELECT p.*, k.name AS kid_name, e.course_name, u.name AS parent_name, u.email AS parent_email
         FROM payments p
         JOIN kids k ON p.kid_id = k.id
         JOIN enrollments e ON p.enrollment_id = e.id
         JOIN users u ON p.parent_id = u.id
         WHERE p.id = $1`,
        [payment.id]
      );

      if (receiptData.rows.length > 0) {
        const r = receiptData.rows[0];
        await sendReceiptEmail({
          email:          r.parent_email,
          parent_name:    r.parent_name,
          kid_name:       r.kid_name,
          course_name:    r.course_name,
          amount:         r.amount,
          method:         'M-Pesa',
          reference:      mpesaRef,
          date:           r.date,
          description:    r.description,
          receipt_number: r.receipt_number,
          status:         'completed',
        });
      }

      return res.status(200).json({
        status: 'success',
        data: { payment_status: 'completed', enrollment_status: 'active' }
      });
    }

    // ── Payment cancelled or timed out ──────────────────────────────────────
    if (resultCode === 1032 || resultCode === 1037) {
      await client.query(
        `UPDATE payments SET status = 'failed' WHERE id = $1`,
        [payment.id]
      );
      return res.status(200).json({
        status: 'success',
        data: { payment_status: 'failed', enrollment_status: 'pending' }
      });
    }

    return res.status(200).json({
      status: 'success',
      data: { payment_status: 'pending', enrollment_status: 'pending' }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

// ─── STK CALLBACK ─────────────────────────────────────────────────────────────

export const stkCallback = async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const callbackData = req.body.Body?.stkCallback;

    if (!callbackData) {
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const { ResultCode, CheckoutRequestID, CallbackMetadata } = callbackData;

    if (ResultCode !== 0) {
      await pool.query(
        `UPDATE payments SET status = 'failed' WHERE reference = $1`,
        [CheckoutRequestID]
      );
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const meta = CallbackMetadata.Item as Array<{ Name: string; Value: string }>;
    const get = (name: string) => meta.find((i) => i.Name === name)?.Value;
    const mpesaRef = get('MpesaReceiptNumber');

    await client.query('BEGIN');

    const updated = await client.query(
      `UPDATE payments
       SET status = 'completed', reference = $1
       WHERE reference = $2
       RETURNING *`,
      [mpesaRef, CheckoutRequestID]
    );

    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const payment = updated.rows[0];

    await confirmEnrollmentPayment(client, payment.enrollment_id);  // ← replaces old UPDATE

    await client.query('COMMIT');

    const receiptData = await pool.query(
      `SELECT p.*, k.name AS kid_name, e.course_name, u.name AS parent_name, u.email AS parent_email
       FROM payments p
       JOIN kids k ON p.kid_id = k.id
       JOIN enrollments e ON p.enrollment_id = e.id
       JOIN users u ON p.parent_id = u.id
       WHERE p.id = $1`,
      [payment.id]
    );

    if (receiptData.rows.length > 0) {
      const r = receiptData.rows[0];
      await sendReceiptEmail({
        email:          r.parent_email,
        parent_name:    r.parent_name,
        kid_name:       r.kid_name,
        course_name:    r.course_name,
        amount:         r.amount,
        method:         'M-Pesa',
        reference:      r.reference,
        date:           r.date,
        description:    r.description,
        receipt_number: r.receipt_number,
        status:         'completed',
      });
    }

    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('STK Callback error:', error);
    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } finally {
    client.release();
  }
};

// ─── C2B VALIDATION ──────────────────────────────────────────────────────────

export const c2bValidation = (req: Request, res: Response) => {
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
};

// ─── C2B CONFIRMATION ────────────────────────────────────────────────────────

export const c2bConfirmation = async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const {
      TransID, TransAmount, MSISDN, BillRefNumber, FirstName, LastName,
    } = req.body;

    const enrollment = await client.query(
      `SELECT e.*, k.id AS kid_id, k.name AS kid_name
       FROM enrollments e
       JOIN kids k ON e.kid_id = k.id
       WHERE e.id = $1 AND e.status IN ('pending', 'active')`,
      [BillRefNumber]
    );

    if (enrollment.rows.length === 0) {
      console.warn(`C2B: No enrollment found for BillRefNumber ${BillRefNumber}`);
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const enr = enrollment.rows[0];
    const receiptNumber = `RCP-${Date.now()}`;

    await client.query('BEGIN');

    await client.query(
      `INSERT INTO payments
        (enrollment_id, kid_id, parent_id, amount, method, reference, description, receipt_number, status, date)
       VALUES ($1, $2, $3, $4, 'M-Pesa', $5, $6, $7, 'completed', NOW())`,
      [
        enr.id, enr.kid_id, enr.parent_id, TransAmount, TransID,
        `C2B payment from ${FirstName} ${LastName} — ${MSISDN}`,
        receiptNumber,
      ]
    );

    await confirmEnrollmentPayment(client, enr.id);  // ← replaces old UPDATE

    await client.query('COMMIT');

    const receiptData = await client.query(
      `SELECT u.name AS parent_name, u.email AS parent_email FROM users u WHERE u.id = $1`,
      [enr.parent_id]
    );

    if (receiptData.rows.length > 0) {
      const r = receiptData.rows[0];
      await sendReceiptEmail({
        email:          r.parent_email,
        parent_name:    r.parent_name,
        kid_name:       enr.kid_name,
        course_name:    enr.course_name,
        amount:         TransAmount,
        method:         'M-Pesa',
        reference:      TransID,
        date:           new Date().toISOString(),
        description:    `C2B payment from ${FirstName} ${LastName}`,
        receipt_number: receiptNumber,
        status:         'completed',
      });
    }

    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('C2B Confirmation error:', error);
    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } finally {
    client.release();
  }
};

// ─── REGISTER C2B URLS ───────────────────────────────────────────────────────

export const registerUrls = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await registerC2BUrls();
    res.status(200).json({ status: 'success', data: result });
  } catch (error) {
    next(error);
  }
};