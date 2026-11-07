import { z } from 'zod';
import { kenyanPhone, uuid } from './common';

// The amount is deliberately NOT accepted from the browser. The server decides
// what is owed from the enrollment record.
export const stkPushSchema = z.object({
  enrollment_id: uuid,
  phone: kenyanPhone,
});

export const enrollmentIdParam = z.object({ enrollmentId: uuid });
export const paymentIdParam = z.object({ paymentId: uuid });
