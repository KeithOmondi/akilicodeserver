import { z } from 'zod';

export const uuid = z.string().uuid('must be a valid id');

/** Kenyan mobile number in any common form -> 2547XXXXXXXX / 2541XXXXXXXX. */
export const normalizeKenyanPhone = (raw: string): string | null => {
  const digits = raw.replace(/[\s\-()+]/g, '');
  const m = digits.match(/^(?:254|0)?([17]\d{8})$/);
  return m ? `254${m[1]}` : null;
};

/**
 * Canonical phone format used for accounts and OTP: E.164 with a leading "+".
 *  - Kenyan numbers in any local form (0712…, 254712…, +254712…) -> +254712…
 *  - Other countries must be typed with their "+" country code.
 * Returns null if it is not a plausible number.
 */
export const toE164 = (raw: string): string | null => {
  const cleaned = raw.trim().replace(/[\s\-()]/g, '');
  const ke = normalizeKenyanPhone(cleaned);
  if (ke) return `+${ke}`;
  return /^\+[1-9]\d{8,14}$/.test(cleaned) ? cleaned : null;
};

/**
 * Every spelling an older account may have stored for the same number
 * (the first version saved whatever the parent typed).
 */
export const phoneVariants = (e164: string): string[] => {
  const out = new Set<string>([e164, e164.slice(1)]);
  if (e164.startsWith('+254')) out.add(`0${e164.slice(4)}`);
  return [...out];
};

export const kenyanPhone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = normalizeKenyanPhone(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'enter a valid Kenyan phone number, e.g. 0712 345 678' });
      return z.NEVER;
    }
    return n;
  });

/** Any phone number a parent may sign up or log in with -> canonical +E.164. */
export const phoneAny = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = toE164(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'enter a valid phone number, e.g. 0712 345 678 or +44 7700 900123' });
      return z.NEVER;
    }
    return n;
  });

export const email = z.string().trim().toLowerCase().email('enter a valid email').max(254);

export const password = z
  .string()
  .min(8, 'must be at least 8 characters')
  .max(72, 'must be at most 72 characters') // bcrypt ignores bytes after 72
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'must contain a letter and a number');

export const personName = z.string().trim().min(2, 'is too short').max(100, 'is too long');
