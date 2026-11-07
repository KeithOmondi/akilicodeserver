import { z } from 'zod';
import { uuid } from './common';

// As with M-Pesa, the amount is NOT accepted from the browser: the server reads what is owed from the enrollment.
export const paystackInitSchema = z.object({
  enrollment_id: uuid,
});

// The reference is made by us (letters and digits). Paystack's own callbacks may add "-" "." "=".
export const paystackReferenceParam = z.object({
  reference: z.string().regex(/^[A-Za-z0-9._=-]{6,100}$/, 'is not a valid payment reference'),
});
