import axios from 'axios';
import env from '../config/env';
import { normalizeKenyanPhone } from '../validators/common';

const BASE_URL =
  env.MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

const HTTP_TIMEOUT_MS = 15000;

/** Safaricom-facing URL = configured base URL + secret path segment. */
export const withSecret = (base: string) => `${base}/${env.MPESA_CALLBACK_SECRET}`;

// ─── GET OAUTH TOKEN ─────────────────────────────────────────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;
let tokenRequest: Promise<string> | null = null;

/** Forget the saved token (used when Safaricom says it is no longer valid). */
export const clearMpesaToken = () => {
  cachedToken = null;
};

/**
 * One access token lasts about an hour. It is kept (and refreshed 5 minutes early), and people who need it at the
 * same moment share ONE request. Asking for a new token for every payment check doubled the calls to Safaricom and
 * got us rate-limited, after which payments could no longer be confirmed.
 */
export const getMpesaToken = async (): Promise<string> => {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;
  if (tokenRequest) return tokenRequest;

  tokenRequest = (async () => {
    try {
      const credentials = Buffer.from(`${env.MPESA_CONSUMER_KEY}:${env.MPESA_CONSUMER_SECRET}`).toString('base64');
      const response = await axios.get(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
        headers: { Authorization: `Basic ${credentials}` },
        timeout: HTTP_TIMEOUT_MS,
      });
      const token = response.data.access_token as string;
      const lifetime = Number(response.data.expires_in) || 3599;
      cachedToken = { token, expiresAt: Date.now() + Math.max(60, lifetime - 300) * 1000 };
      return token;
    } finally {
      tokenRequest = null;
    }
  })();
  return tokenRequest;
};

/** Run a Safaricom call with the saved token; if Safaricom rejects the token (401), get a fresh one and try once more. */
const withToken = async <T>(call: (token: string) => Promise<T>): Promise<T> => {
  try {
    return await call(await getMpesaToken());
  } catch (err: any) {
    if (err?.response?.status === 401) {
      clearMpesaToken();
      return call(await getMpesaToken());
    }
    throw err;
  }
};

// ─── GENERATE PASSWORD ───────────────────────────────────────────────────────

export const generatePassword = (): { password: string; timestamp: string } => {
  const timestamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, '')
    .slice(0, 14);

  const password = Buffer.from(
    `${env.MPESA_SHORTCODE}${env.MPESA_PASSKEY}${timestamp}`
  ).toString('base64');

  return { password, timestamp };
};

// ─── INITIATE STK PUSH ───────────────────────────────────────────────────────

export const initiateStkPush = async (
  phone: string,
  amount: number,
  accountReference: string,
  description: string
) => {
  const formattedPhone = normalizeKenyanPhone(phone);
  if (!formattedPhone) throw new Error('Invalid Kenyan phone number');

  const { password, timestamp } = generatePassword();

  const response = await withToken((token) => axios.post(
    `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
    {
      BusinessShortCode: env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: env.MPESA_TRANSACTION_TYPE,
      Amount: Math.round(amount),
      PartyA: formattedPhone,
      PartyB: env.MPESA_PARTY_B,
      PhoneNumber: formattedPhone,
      CallBackURL: withSecret(env.MPESA_CALLBACK_URL),
      AccountReference: accountReference.slice(0, 12),
      TransactionDesc: description.slice(0, 13),
    },
    { headers: { Authorization: `Bearer ${token}` }, timeout: HTTP_TIMEOUT_MS }
  ));

  return response.data;
};

// ─── QUERY STK PUSH STATUS ───────────────────────────────────────────────────
// Throws if Safaricom says the request is still being processed (HTTP 500).

export const querySTKStatus = async (checkoutRequestId: string) => {
  const { password, timestamp } = generatePassword();

  const response = await withToken((token) => axios.post(
    `${BASE_URL}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    },
    { headers: { Authorization: `Bearer ${token}` }, timeout: HTTP_TIMEOUT_MS }
  ));

  return response.data;
};

// ─── REGISTER C2B URLS ───────────────────────────────────────────────────────

export const registerC2BUrls = async () => {
  const token = await getMpesaToken();

  const response = await axios.post(
    `${BASE_URL}/mpesa/c2b/v1/registerurl`,
    {
      ShortCode: env.MPESA_SHORTCODE,
      ResponseType: 'Completed',
      ConfirmationURL: withSecret(env.MPESA_C2B_CONFIRMATION_URL),
      ValidationURL: withSecret(env.MPESA_C2B_VALIDATION_URL),
    },
    { headers: { Authorization: `Bearer ${token}` }, timeout: HTTP_TIMEOUT_MS }
  );

  return response.data;
};
