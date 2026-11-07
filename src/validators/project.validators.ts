import { z } from 'zod';
import { uuid } from './common';

/** Each file is capped well below what a child could ever need; the whole body is capped again by the route. */
const code = z.string().max(60_000, 'is too long (60,000 characters at most)');

export const projectIdParam = z.object({ id: uuid });
export const lessonIdParam = z.object({ lessonId: uuid });

export const saveProjectSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  html: code.optional(),
  css: code.optional(),
  js: code.optional(),
});

export const createProjectSchema = saveProjectSchema;

export const reviewProjectSchema = z.object({
  marks: z.number().int().min(0).max(100),
  feedback: z.string().trim().max(2000).optional(),
});

export const adminProjectsQuery = z.object({
  status: z.enum(['submitted', 'reviewed', 'all']).optional(),
});
