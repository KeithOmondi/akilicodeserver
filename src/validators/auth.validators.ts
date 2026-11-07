import { z } from 'zod';
import { email, password, personName, phoneAny } from './common';

// NOTE: no `role` field on purpose. Public sign-up always creates a parent.
export const registerSchema = z.object({
  name: personName,
  email,
  phone: phoneAny,
  password,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'is required').max(72),
});

export const forgotPasswordSchema = z.object({ email });

const token64 = z.string().regex(/^[a-f0-9]{64}$/, 'is invalid');

export const resetPasswordSchema = z.object({
  token: token64,
  newPassword: password,
});

export const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(72),
  newPassword: password,
});

export const verifyEmailQuery = z.object({ token: token64 });

// ── Phone + OTP ──────────────────────────────────────────────────────────────

export const otpRequestSchema = z.object({
  phone: phoneAny,
  purpose: z.enum(['signup', 'login']),
});

const code6 = z.string().trim().regex(/^\d{6}$/, 'must be the 6-digit code from the text message');

export const otpVerifySchema = z
  .object({
    phone: phoneAny,
    purpose: z.enum(['signup', 'login']),
    code: code6,
    name: personName.optional(),
    accept_terms: z.boolean().optional(),
  })
  .refine((v) => v.purpose !== 'signup' || !!v.name, { path: ['name'], message: 'is required to create an account' })
  .refine((v) => v.purpose !== 'signup' || v.accept_terms === true, {
    path: ['accept_terms'],
    message: 'you must accept the Terms and Privacy Policy',
  });

// ── Parent gate: password OR a texted code ───────────────────────────────────

export const parentGateSchema = z
  .object({
    password: z.string().min(1).max(72).optional(),
    code: code6.optional(),
  })
  .refine((v) => !!v.password !== !!v.code, 'send either your password or your code');

// ── Account deletion ─────────────────────────────────────────────────────────

/** A parent may change their display name. Email and phone are sign-in identities, so they are not editable here. */
export const updateProfileSchema = z.object({ name: z.string().trim().min(2).max(80) });

export const deleteAccountSchema = z.object({ confirm: z.literal('DELETE') });
