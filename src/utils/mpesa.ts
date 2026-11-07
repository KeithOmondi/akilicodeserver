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

export const getMpesaToken = async (): Promise<string> => {
  const credentials = Buffer.from(
    `${env.MPESA_CONSUMER_KEY}:${env.MPESA_CONSUMER_SECRET}`
  ).toString('base64');

  const response = await axios.get(
    `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${credentials}` }, timeout: HTTP_TIMEOUT_MS }
  );

  return response.data.access_token;
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

  const token = await getMpesaToken();
  const { password, timestamp } = generatePassword();

  const response = await axios.post(
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
  );

  return response.data;
};

// ─── QUERY STK PUSH STATUS ───────────────────────────────────────────────────
// Throws if Safaricom says the request is still being processed (HTTP 500).

export const querySTKStatus = async (checkoutRequestId: string) => {
  const token = await getMpesaToken();
  const { password, timestamp } = generatePassword();

  const response = await axios.post(
    `${BASE_URL}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    },
    { headers: { Authorization: `Bearer ${token}` }, timeout: HTTP_TIMEOUT_MS }
  );

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
