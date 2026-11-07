import { Request } from 'express';
import rateLimit, { ipKeyGenerator, Options } from 'express-rate-limit';
import env from '../config/env';

/**
 * Rate limiters. Counters live in process memory, which is correct for one
 * server instance. If you run more than one instance, switch to a shared
 * store (Redis) — see README "Scaling".
 */

const tooMany = (message: string): Partial<Options> => ({
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ status: 'fail', message });
  },
});

const ipOf = (req: Request) => ipKeyGenerator(req.ip ?? '');
const emailOf = (req: Request) =>
  typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim().slice(0, 254) : '';
const userOf = (req: Request) => (req.user as { id?: string } | undefined)?.id ?? '';

/** Everything under /api: a broad safety net per IP. */
export const apiLimiter = rateLimit({
  ...tooMany('Too many requests. Please slow down and try again shortly.'),
  windowMs: 15 * 60 * 1000,
  limit: env.IS_PRODUCTION ? 600 : 5000,
});

/** Parent login: per IP + email, so one attacker cannot hammer one account. */
export const loginLimiter = rateLimit({
  ...tooMany('Too many login attempts. Please wait 15 minutes and try again.'),
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipOf(req)}|${emailOf(req)}`,
});

/** Same, but only per IP, to stop one IP from spraying many emails. */
export const loginIpLimiter = rateLimit({
  ...tooMany('Too many login attempts. Please wait 15 minutes and try again.'),
  windowMs: 15 * 60 * 1000,
  limit: 40,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => ipOf(req),
});

export const registerLimiter = rateLimit({
  ...tooMany('Too many sign-up attempts. Please try again in an hour.'),
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => ipOf(req),
});

/** Forgot / reset password. */
export const passwordResetLimiter = rateLimit({
  ...tooMany('Too many password reset requests. Please try again in an hour.'),
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => `${ipOf(req)}|${emailOf(req)}`,
});

/** Email-link / OTP verification (and phone OTP when it is added in Phase 2). */
export const otpLimiter = rateLimit({
  ...tooMany('Too many verification attempts. Please wait 10 minutes.'),
  windowMs: 10 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => ipOf(req),
});

/** Child PIN login: IP-level cap. Per-child lockout is stored in the database. */
export const kidLoginLimiter = rateLimit({
  ...tooMany('Too many tries. Please ask a grown-up to help, or wait a few minutes.'),
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => ipOf(req),
});

/** Payment initiation: per logged-in parent. */
export const paymentLimiter = rateLimit({
  ...tooMany('Too many payment attempts. Please wait a few minutes before trying again.'),
  windowMs: 10 * 60 * 1000,
  limit: 6,
  keyGenerator: (req) => userOf(req) || ipOf(req),
});

/** Payment status polling (the app checks every few seconds). */
export const paymentStatusLimiter = rateLimit({
  ...tooMany('Checking too often. Please wait a moment.'),
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: (req) => userOf(req) || ipOf(req),
});

/** Safaricom-facing URLs: generous, but bounded. */
export const mpesaWebhookLimiter = rateLimit({
  ...tooMany('Too many requests.'),
  windowMs: 60 * 1000,
  limit: 120,
  keyGenerator: (req) => ipOf(req),
});

/** SMS costs money: few sends per IP per hour. (Per-phone and site-wide caps are in otpService.) */
export const otpSendIpLimiter = rateLimit({
  ...tooMany('Too many text messages requested from this connection. Please try again later.'),
  windowMs: 60 * 60 * 1000,
  limit: 6,
  keyGenerator: (req) => ipOf(req),
});

/** Guessing a 6-digit code: per IP + phone. (Each code also dies after 5 wrong tries.) */
export const otpVerifyLimiter = rateLimit({
  ...tooMany('Too many attempts. Please request a new code in a few minutes.'),
  windowMs: 10 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => `${ipOf(req)}|${typeof req.body?.phone === 'string' ? req.body.phone : ''}`,
});

/** Parent gate: wrong passwords / codes per logged-in parent. */
export const gateLimiter = rateLimit({
  ...tooMany('Too many tries. Please wait 15 minutes.'),
  windowMs: 15 * 60 * 1000,
  limit: 8,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => userOf(req) || ipOf(req),
});

/** Child heartbeat: a child page pings about once a minute. */
export const heartbeatLimiter = rateLimit({
  ...tooMany('Too many requests.'),
  windowMs: 60 * 1000,
  limit: 6,
  keyGenerator: (req) => userOf(req) || ipOf(req),
});

/** Data export / delete: heavy and sensitive. */
export const dataRequestLimiter = rateLimit({
  ...tooMany('Too many requests. Please try again later.'),
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => userOf(req) || ipOf(req),
});
