import { z } from 'zod';
import { uuid } from './common';

// ── Things a child can send ──────────────────────────────────────────────────

export const lessonParams = z.object({ enrollmentId: uuid, lessonId: uuid });
export const enrollmentParam = z.object({ enrollmentId: uuid });
export const lessonIdParam = z.object({ lessonId: uuid });

/** Code the child typed for an exercise. Size-capped so it cannot be used to fill the database. */
export const submitLessonSchema = z.object({
  code_submitted: z.string().max(20000, 'is too long').optional().nullable(),
});

export const limitQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/** GET /kid/calendar?year=2026&month=5 — both together or neither. */
export const calendarQuery = z
  .object({
    year: z.coerce.number().int().min(2020).max(2100).optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
  })
  .refine((v) => (v.year === undefined) === (v.month === undefined), 'send both year and month, or neither');

// GitHub URL: https://github.com/<user>/<repo> (the controller also checks this again)
export const submitAssignmentSchema = z.object({
  lesson_id: uuid,
  enrollment_id: uuid,
  github_url: z.string().trim().url().max(300).regex(/^https:\/\/(www\.)?github\.com\/[\w.-]+\/[\w.-]+/i, 'must be a github.com repository link'),
});

export const reviewSubmissionSchema = z.object({
  marks: z.number().min(0).max(100),
  feedback: z.string().trim().max(2000).optional().nullable(),
});

export const submissionIdParam = z.object({ submissionId: uuid });

export const adminSubmissionsQuery = z.object({
  status: z.string().max(20).optional(),
  lesson_id: uuid.optional(),
  course_id: uuid.optional(),
});

// Quiz: the student is always the logged-in child; an id in the body is ignored.
export const submitQuizSchema = z.object({
  /** The child's enrollment, so a passed quiz can complete the lesson. Optional: without it the quiz is only graded. */
  enrollmentId: uuid.optional(),
  answers: z
    .array(z.object({ questionId: uuid, selectedIndex: z.number().int().min(0).max(20) }))
    .min(1)
    .max(100),
});

// ── Trials & enrollments (parent) ────────────────────────────────────────────

export const startTrialSchema = z.object({ kid_id: uuid, course_id: uuid });
export const trialParams = z.object({ kid_id: uuid, course_id: uuid });
export const convertTrialParams = z.object({ trial_id: uuid });
export const convertTrialSchema = z.object({ enrollment_id: uuid });

export const enrollKidSchema = z.object({
  kid_id: uuid,
  course_id: uuid,
  fee_amount: z.coerce.number().positive().max(1_000_000),
  billing_cycle: z.enum(['monthly', 'termly', 'once-off']),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'must be a date like 2026-12-01').optional().nullable(),
});
