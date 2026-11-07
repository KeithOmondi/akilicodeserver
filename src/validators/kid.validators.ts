import { z } from 'zod';
import { uuid } from './common';
import { AGE_GROUP_IDS } from '../utils/ageGroups';

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, 'use 3-20 letters, numbers or underscores');

const pin = z.string().regex(/^\d{4}$/, 'must be exactly 4 digits');

// Login is lenient on username format so older accounts (created before the format rule) still work.
export const kidLoginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(40),
  pin,
});

/** The parent ticked the consent box, in the version of the text they were shown. */
export const consentSchema = z.object({
  accepted: z.literal(true, { message: 'you must agree to continue' }),
  is_guardian: z.literal(true, { message: 'you must confirm you are the parent or guardian' }),
  version: z.string().min(1).max(40),
});

const thisYear = new Date().getFullYear();

export const registerKidSchema = z.object({
  name: z.string().trim().min(1).max(40), // nickname, not a full legal name
  age: z.coerce.number().int().min(3).max(19),
  birth_year: z.coerce.number().int().min(thisYear - 20).max(thisYear).optional().nullable(),
  grade: z.string().trim().max(50).optional().nullable(),
  avatar: z.string().trim().max(100).optional().nullable(),
  /** Chosen from a dropdown; if left out it is worked out from the age. */
  age_group: z.enum(AGE_GROUP_IDS).optional(),
  consent: consentSchema,
});

export const consentForExistingKidSchema = z.object({ consent: consentSchema });

export const updateKidSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  age: z.coerce.number().int().min(3).max(19).optional(),
  age_group: z.enum(AGE_GROUP_IDS).optional(),
  grade: z.string().trim().max(50).optional().nullable(),
  avatar: z.string().trim().max(100).optional().nullable(),
});

export const setKidLoginSchema = z.object({ username, pin });

export const updateKidLoginSchema = z
  .object({ username: username.optional(), pin: pin.optional() })
  .refine((v) => v.username || v.pin, 'provide a username or a PIN');

export const setPinSchema = z.object({ pin });
export const leaderboardSchema = z.object({ opt_in: z.boolean() });
export const pickerLoginSchema = z.object({ kid_id: uuid, pin });

export const screenTimeSchema = z
  .object({
    daily_limit_minutes: z.number().int().min(0).max(1440).nullable().optional(),
    break_every_minutes: z.number().int().min(5).max(180).optional(),
  })
  .refine((v) => v.daily_limit_minutes !== undefined || v.break_every_minutes !== undefined, 'nothing to change');

export const heartbeatSchema = z.object({ seconds: z.number().min(0).max(120) });

export const deleteKidSchema = z.object({ confirm_name: z.string().trim().min(1).max(60) });

export const kidIdParam = z.object({ kidId: uuid });
