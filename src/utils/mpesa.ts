import axios from 'axios';
import env from '../config/env';

const BASE_URL =
  env.MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

// ─── GET OAUTH TOKEN ─────────────────────────────────────────────────────────

export const getMpesaToken = async (): Promise<string> => {
  const credentials = Buffer.from(
    `${env.MPESA_CONSUMER_KEY}:${env.MPESA_CONSUMER_SECRET}`
  ).toString('base64');

  const response = await axios.get(
    `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: { Authorization: `Basic ${credentials}` },
    }
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
  const token = await getMpesaToken();
  const { password, timestamp } = generatePassword();

  let formattedPhone = phone.replace(/\D/g, '');
  if (formattedPhone.startsWith('0')) {
    formattedPhone = '254' + formattedPhone.slice(1);
  } else if (formattedPhone.startsWith('7')) {
    formattedPhone = '254' + formattedPhone;
  }

  const response = await axios.post(
    `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
    {
      BusinessShortCode: env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: formattedPhone,
      PartyB: env.MPESA_SHORTCODE,
      PhoneNumber: formattedPhone,
      CallBackURL: env.MPESA_CALLBACK_URL,
      AccountReference: accountReference.slice(0, 12),
      TransactionDesc: description.slice(0, 13),
    },
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  return response.data;
};

// ─── QUERY STK PUSH STATUS ───────────────────────────────────────────────────

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
    { headers: { Authorization: `Bearer ${token}` } }
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
      ConfirmationURL: env.MPESA_C2B_CONFIRMATION_URL,
      ValidationURL: env.MPESA_C2B_VALIDATION_URL,
    },
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  return response.data;
};