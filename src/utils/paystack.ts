import axios from 'axios';
import crypto from 'crypto';
import env from '../config/env';

/**
 * Talking to Paystack. Three things only:
 *  - start a payment (initialize)  -> a page the parent is sent to, to pay by CARD
 *    (mobile money / M-Pesa is NOT offered here: M-Pesa is paid through our own direct M-Pesa integration)
 *  - ask Paystack what really happened (verify)
 *  - check that a webhook really came from Paystack (signature)
 *
 * Amounts: Paystack wants the smallest unit (KES 4,000 is 400000). Currency is always KES.
 */

const BASE_URL = 'https://api.paystack.co';
const HTTP_TIMEOUT_MS = 15000;
export const PAYSTACK_CURRENCY = 'KES';

export const isPaystackEnabled = () => env.PAYSTACK_SECRET_KEY.length > 0;

/** KES (may have cents) -> the smallest unit Paystack counts in. */
export const toSubunit = (amount: number | string) => Math.round(Number(amount) * 100);

const client = () =>
  axios.create({
    baseURL: BASE_URL,
    timeout: HTTP_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
  });

/** Paystack is used for cards only. */
export const PAYSTACK_CHANNELS = ['card'] as const;

/** The request we send to Paystack to start a payment (a separate function so it can be tested). */
export const buildInitializeBody = (p: { email: string; amountKes: number; reference: string; callbackUrl: string; metadata?: Record<string, unknown> }) => ({
  email: p.email,
  amount: toSubunit(p.amountKes),
  currency: PAYSTACK_CURRENCY,
  reference: p.reference,
  callback_url: p.callbackUrl,
  // only the card option is shown on Paystack's page, whatever else the Paystack account has switched on
  channels: [...PAYSTACK_CHANNELS],
  metadata: p.metadata ?? {},
});

export type InitializeResult = { authorization_url: string; access_code: string; reference: string };

export const initializeTransaction = async (p: {
  email: string;
  amountKes: number;
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}): Promise<InitializeResult> => {
  const res = await client().post('/transaction/initialize', buildInitializeBody(p));
  if (!res.data?.status || !res.data?.data?.authorization_url) {
    throw new Error(String(res.data?.message ?? 'Paystack did not return a payment page.'));
  }
  return res.data.data as InitializeResult;
};

export type VerifiedTransaction = {
  /** success | failed | abandoned | ongoing | pending | reversed | queued */
  status: string;
  reference: string;
  /** smallest unit */
  amount: number;
  currency: string;
  gateway_response?: string;
  channel?: string;
  id?: number;
};

export const verifyTransaction = async (reference: string): Promise<VerifiedTransaction> => {
  const res = await client().get(`/transaction/verify/${encodeURIComponent(reference)}`);
  if (!res.data?.status || !res.data?.data) throw new Error(String(res.data?.message ?? 'Paystack could not verify this payment.'));
  return res.data.data as VerifiedTransaction;
};

/**
 * Paystack signs every webhook: x-paystack-signature = HMAC-SHA512 of the EXACT raw body, keyed with our secret key.
 * Compared in constant time. Anything else is not from Paystack.
 */
export const isValidWebhookSignature = (rawBody: Buffer | string, signature: string | undefined, secret = env.PAYSTACK_SECRET_KEY): boolean => {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature).toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
