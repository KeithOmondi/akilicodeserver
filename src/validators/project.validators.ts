import { z } from 'zod';
import { uuid } from './common';

/** Each file is capped well below what a child could ever need; the whole body is capped again by the route. */
const code = z.string().max(60_000, 'is too long (60,000 characters at most)');

/**
 * A block project is stored as JSON: the sprites, their blocks, and the pictures a child painted or uploaded
 * (small images written as data: addresses). Capped so one project cannot be huge, and the only data: addresses
 * allowed are real image types, so nothing else can be tucked inside.
 */
const BLOCKS_MAX_CHARS = 1_500_000;
const blocks = z
  .record(z.string(), z.unknown())
  .refine((v) => JSON.stringify(v).length <= BLOCKS_MAX_CHARS, 'is too big (1,500,000 characters at most)')
  .refine((v) => !/"data:(?!image\/(png|jpeg|webp|gif);base64,)/i.test(JSON.stringify(v)), 'may only contain PNG, JPEG, WEBP or GIF pictures');

export const projectIdParam = z.object({ id: uuid });
export const lessonIdParam = z.object({ lessonId: uuid });

export const saveProjectSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  html: code.optional(),
  css: code.optional(),
  js: code.optional(),
  blocks: blocks.optional(),
});

export const createProjectSchema = saveProjectSchema.extend({ kind: z.enum(['web', 'blocks']).optional() });

export const reviewProjectSchema = z.object({
  marks: z.number().int().min(0).max(100),
  feedback: z.string().trim().max(2000).optional(),
});

export const adminProjectsQuery = z.object({
  status: z.enum(['submitted', 'reviewed', 'all']).optional(),
});
