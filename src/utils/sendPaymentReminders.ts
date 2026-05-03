import pool from '../config/db';
import { buildPaymentReminderHtml } from './mailsTemplate';
import sendMail from './sendMail';

export const sendPaymentReminders = async () => {
  try {
    // Find all active enrollments where next_payment_date is exactly 7 days from today
    const result = await pool.query(
      `SELECT 
        e.*,
        k.name AS kid_name,
        u.name AS parent_name,
        u.email AS parent_email,
        e.next_payment_date
       FROM enrollments e
       JOIN kids k ON e.kid_id = k.id
       JOIN users u ON e.parent_id = u.id
       WHERE e.status = 'active'
         AND e.billing_cycle != 'once-off'
         AND e.next_payment_date = CURRENT_DATE + INTERVAL '7 days'`
    );

    for (const enrollment of result.rows) {
      // FIX: Changed 'email' to 'to' and 'message' to 'text' to match SendMailOptions
      await sendMail({
        to: enrollment.parent_email, 
        subject: `Payment Reminder — ${enrollment.course_name} due in 7 days`,
        text: `Hi ${enrollment.parent_name}, your payment of KES ${enrollment.fee_amount} for ${enrollment.kid_name} (${enrollment.course_name}) is due on ${enrollment.next_payment_date}.`,
        html: buildPaymentReminderHtml({
          parent_name: enrollment.parent_name,
          kid_name: enrollment.kid_name,
          course_name: enrollment.course_name,
          fee_amount: enrollment.fee_amount,
          billing_cycle: enrollment.billing_cycle,
          next_payment_date: enrollment.next_payment_date,
        }),
      });

      console.log(`Reminder sent to ${enrollment.parent_email} for ${enrollment.course_name}`);
    }

    console.log(`Payment reminders sent: ${result.rows.length}`);
  } catch (error) {
    console.error('Error sending payment reminders:', error);
  }
};