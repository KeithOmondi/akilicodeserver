import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

interface Config {
  PORT: number;
  NODE_ENV: string;
  ALLOWED_ORIGIN: string;
  DATABASE_URL: string;
  // JWT Configuration
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_ACCESS_EXPIRES_IN: string;
  JWT_REFRESH_EXPIRES_IN: string;
  // Brevo/Email Configuration
  BREVO_API_KEY: string;
  MAIL_FROM_NAME: string;
  MAIL_FROM_EMAIL: string;
  EMAIL_HOST: string;
  EMAIL_PORT: number;
  EMAIL_USER: string;
  EMAIL_PASS: string;
  LOGO_URL: string;
  // M-Pesa Configuration
  MPESA_CONSUMER_KEY: string;
  MPESA_CONSUMER_SECRET: string;
  MPESA_SHORTCODE: string;
  MPESA_PASSKEY: string;
  MPESA_CALLBACK_URL: string;
  MPESA_C2B_VALIDATION_URL: string;
  MPESA_C2B_CONFIRMATION_URL: string;
  MPESA_ENV: 'sandbox' | 'production';
}

const getSanitizedConfig = (config: NodeJS.ProcessEnv): Config => {
  const requiredVars = [
    'PORT',
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'BREVO_API_KEY',
    'MAIL_FROM_NAME',
    'MAIL_FROM_EMAIL',
    'EMAIL_HOST',
    'EMAIL_USER',
    'EMAIL_PASS',
    // M-Pesa
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
    'MPESA_SHORTCODE',
    'MPESA_PASSKEY',
    'MPESA_CALLBACK_URL',
    'MPESA_C2B_VALIDATION_URL',
    'MPESA_C2B_CONFIRMATION_URL',
  ];

  requiredVars.forEach((key) => {
    if (!config[key]) {
      throw new Error(`❌ Missing critical variable in .env: ${key}`);
    }
  });

  return {
    PORT: Number(config.PORT),
    NODE_ENV: config.NODE_ENV || 'development',
    ALLOWED_ORIGIN: config.ALLOWED_ORIGIN || '*',
    DATABASE_URL: config.DATABASE_URL || '',
    // JWT Values
    JWT_ACCESS_SECRET: config.JWT_ACCESS_SECRET!,
    JWT_REFRESH_SECRET: config.JWT_REFRESH_SECRET!,
    JWT_ACCESS_EXPIRES_IN: config.JWT_ACCESS_EXPIRES_IN || '15m',
    JWT_REFRESH_EXPIRES_IN: config.JWT_REFRESH_EXPIRES_IN || '7d',
    // Brevo / Email Values
    BREVO_API_KEY: config.BREVO_API_KEY!,
    MAIL_FROM_NAME: config.MAIL_FROM_NAME!,
    MAIL_FROM_EMAIL: config.MAIL_FROM_EMAIL!,
    EMAIL_HOST: config.EMAIL_HOST!,
    EMAIL_PORT: Number(config.EMAIL_PORT) || 465,
    EMAIL_USER: config.EMAIL_USER!,
    EMAIL_PASS: config.EMAIL_PASS!,
    LOGO_URL: config.LOGO_URL || '',
    // M-Pesa Values
    MPESA_CONSUMER_KEY: config.MPESA_CONSUMER_KEY!,
    MPESA_CONSUMER_SECRET: config.MPESA_CONSUMER_SECRET!,
    MPESA_SHORTCODE: config.MPESA_SHORTCODE!,
    MPESA_PASSKEY: config.MPESA_PASSKEY!,
    MPESA_CALLBACK_URL: config.MPESA_CALLBACK_URL!,
    MPESA_C2B_VALIDATION_URL: config.MPESA_C2B_VALIDATION_URL!,
    MPESA_C2B_CONFIRMATION_URL: config.MPESA_C2B_CONFIRMATION_URL!,
    MPESA_ENV: (config.MPESA_ENV as 'sandbox' | 'production') || 'sandbox',
  };
};

export const env = getSanitizedConfig(process.env);

export default env;