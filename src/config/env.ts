import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

interface Config {
  PORT: number;
  NODE_ENV: string;
  IS_PRODUCTION: boolean;
  /** Public URL of the web app. Used in email links. */
  FRONTEND_URL: string;
  /** Exact origins allowed by CORS. Never contains "*". */
  ALLOWED_ORIGINS: string[];
  /** Number of reverse-proxy hops to trust for req.ip (0 = none). */
  TRUST_PROXY: number;
  DATABASE_URL: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_ACCESS_EXPIRES_IN: string;
  JWT_REFRESH_EXPIRES_IN: string;
  BREVO_API_KEY: string;
  MAIL_FROM_NAME: string;
  MAIL_FROM_EMAIL: string;
  LOGO_URL: string;
  MPESA_CONSUMER_KEY: string;
  MPESA_CONSUMER_SECRET: string;
  MPESA_SHORTCODE: string;
  MPESA_PASSKEY: string;
  /** Base callback URL WITHOUT the secret, e.g. https://api.example.com/api/v1/mpesa/callback */
  MPESA_CALLBACK_URL: string;
  MPESA_C2B_VALIDATION_URL: string;
  MPESA_C2B_CONFIRMATION_URL: string;
  /** Long random string appended to every Safaricom-facing URL path. */
  MPESA_CALLBACK_SECRET: string;
  /** Optional comma list of Safaricom source IPs. Empty = IP check off. */
  MPESA_ALLOWED_IPS: string[];
  /** If false (default) C2B payments are recorded for admin review, not auto-unlocked. */
  MPESA_C2B_AUTO_CONFIRM: boolean;
  MPESA_ENV: 'sandbox' | 'production';
  /** CustomerPayBillOnline (Paybill) or CustomerBuyGoodsOnline (Till). */
  MPESA_TRANSACTION_TYPE: 'CustomerPayBillOnline' | 'CustomerBuyGoodsOnline';
  /** Who receives the money: the Paybill number, or the Till number for Buy Goods. */
  MPESA_PARTY_B: string;
  /**
   * Paystack secret key (sk_test_... or sk_live_...). Empty = Paystack is switched off and the card option is hidden.
   * This key can move money: it lives only in the server's environment, never in the code or the browser.
   */
  PAYSTACK_SECRET_KEY: string;
  /** SMS provider: "console" prints codes to the server log (dev/test only). */
  SMS_PROVIDER: 'console' | 'africastalking';
  AT_USERNAME: string;
  AT_API_KEY: string;
  AT_SENDER_ID: string;
  AT_ENV: 'sandbox' | 'production';
  /** Hard cap on SMS sent per rolling 24h across the whole site (cost control). */
  OTP_DAILY_SMS_CAP: number;
  /** Require a recent password/OTP re-check before sensitive actions. */
  PARENT_GATE_REQUIRED: boolean;
}

const MIN_SECRET_LENGTH = 32;

const list = (v: string | undefined): string[] =>
  (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const getSanitizedConfig = (config: NodeJS.ProcessEnv): Config => {
  // Testing aid: USE_DB_BRANCH=true makes the API use DATABASE_URL_BRANCH (a Neon copy) instead of the real database.
  if (config.USE_DB_BRANCH === 'true') {
    if (!config.DATABASE_URL_BRANCH || config.DATABASE_URL_BRANCH === config.DATABASE_URL) {
      throw new Error('❌ USE_DB_BRANCH=true needs DATABASE_URL_BRANCH, different from DATABASE_URL');
    }
    console.warn('🧪 USE_DB_BRANCH=true: using the Neon BRANCH database, not the main one.');
    config = { ...config, DATABASE_URL: config.DATABASE_URL_BRANCH };
  }

  const requiredVars = [
    'PORT',
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'BREVO_API_KEY',
    'MAIL_FROM_NAME',
    'MAIL_FROM_EMAIL',
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
    'MPESA_SHORTCODE',
    'MPESA_PASSKEY',
    'MPESA_CALLBACK_URL',
    'MPESA_C2B_VALIDATION_URL',
    'MPESA_C2B_CONFIRMATION_URL',
    'MPESA_CALLBACK_SECRET',
  ];

  requiredVars.forEach((key) => {
    if (!config[key]) {
      throw new Error(`❌ Missing critical variable in .env: ${key}`);
    }
  });

  // Safe by default: anything that is not explicitly "development" or "test" behaves like production
  // (no stack traces, secure cookies, strict checks). An unset NODE_ENV must never mean "debug mode".
  const nodeEnv = config.NODE_ENV === 'development' || config.NODE_ENV === 'test' ? config.NODE_ENV : 'production';
  const isProduction = nodeEnv === 'production';

  if (isProduction) {
    const prodRequired = ['FRONTEND_URL', 'ALLOWED_ORIGINS', 'MPESA_ENV'];
    const missing = prodRequired.filter((k) => !(k === 'ALLOWED_ORIGINS' ? config.ALLOWED_ORIGINS ?? config.ALLOWED_ORIGIN : config[k]));
    if (missing.length) throw new Error('❌ Missing required production variable(s): ' + missing.join(', '));
    if (!config.FRONTEND_URL!.startsWith('https://')) throw new Error('❌ FRONTEND_URL must start with https:// in production');
    if (config.USE_DB_BRANCH === 'true') throw new Error('❌ USE_DB_BRANCH=true is not allowed in production');
    if (!/sslmode=(verify-full|require)/.test(config.DATABASE_URL!)) {
      throw new Error('❌ DATABASE_URL must include sslmode=verify-full in production');
    }
    if (!(Number(config.TRUST_PROXY) >= 1)) {
      throw new Error('❌ TRUST_PROXY=1 is required in production behind Render (otherwise rate limits see only the proxy IP)');
    }
  }

  // Secrets must be long and distinct.
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'MPESA_CALLBACK_SECRET']) {
    if ((config[key] as string).length < MIN_SECRET_LENGTH) {
      throw new Error(`❌ ${key} must be at least ${MIN_SECRET_LENGTH} characters (use: openssl rand -hex 48)`);
    }
  }
  if (config.JWT_ACCESS_SECRET === config.JWT_REFRESH_SECRET) {
    throw new Error('❌ JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(config.MPESA_CALLBACK_SECRET as string)) {
    throw new Error('❌ MPESA_CALLBACK_SECRET may only contain letters, digits, "-" and "_" (it goes in a URL path)');
  }

  // CORS: explicit allow-list only. ALLOWED_ORIGIN is the legacy single-value name.
  const origins = list(config.ALLOWED_ORIGINS ?? config.ALLOWED_ORIGIN);
  if (origins.includes('*')) {
    throw new Error('❌ ALLOWED_ORIGINS must not contain "*". List the exact origins.');
  }
  if (origins.length === 0) {
    if (isProduction) {
      throw new Error('❌ ALLOWED_ORIGINS is required in production (comma-separated exact origins)');
    }
    origins.push('http://localhost:5173');
  }

  const paystackKey = (config.PAYSTACK_SECRET_KEY ?? '').trim();
  if (paystackKey && !/^sk_(test|live)_[A-Za-z0-9]+$/.test(paystackKey)) {
    throw new Error('❌ PAYSTACK_SECRET_KEY must be a Paystack SECRET key (starts with sk_test_ or sk_live_). Never use the public key (pk_...) here.');
  }
  if (isProduction && paystackKey.startsWith('sk_test_')) {
    console.warn('⚠️  PAYSTACK_SECRET_KEY is a TEST key in production: card payments will not move real money.');
  }

  if (config.SMS_PROVIDER === 'africastalking' && !config.AT_API_KEY) {
    throw new Error('❌ SMS_PROVIDER=africastalking needs AT_API_KEY (and AT_USERNAME)');
  }
  if (isProduction && config.SMS_PROVIDER !== 'africastalking') {
    console.warn('⚠️  SMS_PROVIDER is not "africastalking" in production: phone sign-in codes are NOT sent. Parents can still use email + password.');
  }

  const frontendUrl = (config.FRONTEND_URL || origins[0]).replace(/\/$/, '');

  return {
    PORT: Number(config.PORT) || 5000,
    NODE_ENV: nodeEnv,
    IS_PRODUCTION: isProduction,
    FRONTEND_URL: frontendUrl,
    ALLOWED_ORIGINS: origins,
    TRUST_PROXY: Number(config.TRUST_PROXY ?? 0) || 0,
    DATABASE_URL: config.DATABASE_URL!,
    JWT_ACCESS_SECRET: config.JWT_ACCESS_SECRET!,
    JWT_REFRESH_SECRET: config.JWT_REFRESH_SECRET!,
    JWT_ACCESS_EXPIRES_IN: config.JWT_ACCESS_EXPIRES_IN || '15m',
    JWT_REFRESH_EXPIRES_IN: config.JWT_REFRESH_EXPIRES_IN || '7d',
    BREVO_API_KEY: config.BREVO_API_KEY!,
    MAIL_FROM_NAME: config.MAIL_FROM_NAME!,
    MAIL_FROM_EMAIL: config.MAIL_FROM_EMAIL!,
    LOGO_URL: config.LOGO_URL || '',
    MPESA_CONSUMER_KEY: config.MPESA_CONSUMER_KEY!,
    MPESA_CONSUMER_SECRET: config.MPESA_CONSUMER_SECRET!,
    MPESA_SHORTCODE: config.MPESA_SHORTCODE!,
    MPESA_PASSKEY: config.MPESA_PASSKEY!,
    PAYSTACK_SECRET_KEY: paystackKey,
    MPESA_CALLBACK_URL: config.MPESA_CALLBACK_URL!.replace(/\/$/, ''),
    MPESA_C2B_VALIDATION_URL: config.MPESA_C2B_VALIDATION_URL!.replace(/\/$/, ''),
    MPESA_C2B_CONFIRMATION_URL: config.MPESA_C2B_CONFIRMATION_URL!.replace(/\/$/, ''),
    MPESA_CALLBACK_SECRET: config.MPESA_CALLBACK_SECRET!,
    MPESA_ALLOWED_IPS: list(config.MPESA_ALLOWED_IPS),
    MPESA_C2B_AUTO_CONFIRM: config.MPESA_C2B_AUTO_CONFIRM === 'true',
    MPESA_ENV: (config.MPESA_ENV as 'sandbox' | 'production') || 'sandbox',
    MPESA_TRANSACTION_TYPE:
      config.MPESA_TRANSACTION_TYPE === 'CustomerBuyGoodsOnline' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
    MPESA_PARTY_B: config.MPESA_PARTY_B || config.MPESA_SHORTCODE!,
    SMS_PROVIDER: config.SMS_PROVIDER === 'africastalking' ? 'africastalking' : 'console',
    AT_USERNAME: config.AT_USERNAME || 'sandbox',
    AT_API_KEY: config.AT_API_KEY || '',
    AT_SENDER_ID: config.AT_SENDER_ID || '',
    AT_ENV: config.AT_ENV === 'production' ? 'production' : 'sandbox',
    OTP_DAILY_SMS_CAP: Number(config.OTP_DAILY_SMS_CAP) || 300,
    PARENT_GATE_REQUIRED: config.PARENT_GATE_REQUIRED !== 'false',
  };
};

export const env = getSanitizedConfig(process.env);

export default env;
