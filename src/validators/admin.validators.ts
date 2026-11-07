import { z } from 'zod';
import { uuid } from './common';

const optText = (max: number) => z.string().trim().max(max).optional().nullable();
const orderIndex = z.coerce.number().int().min(0).max(10000);
const money = z.coerce.number().min(0).max(1_000_000);

// ── Courses, modules, lessons, questions ─────────────────────────────────────

export const createCourseSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: optText(5000),
  price: money,
  duration: optText(50),
  category: optText(100),
  image_url: z.string().trim().url().max(1000).optional().nullable().or(z.literal('')),
});

export const updateCourseSchema = createCourseSchema.partial().extend({ is_active: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'nothing to update');

export const createModuleSchema = z.object({
  course_id: uuid,
  title: z.string().trim().min(1).max(255),
  description: optText(5000),
  order_index: orderIndex.optional(),
});
export const updateModuleSchema = createModuleSchema.omit({ course_id: true }).partial();

export const createLessonSchema = z.object({
  module_id: uuid,
  title: z.string().trim().min(1).max(255),
  notes: z.string().max(100000).optional().nullable(),
  assignment: z.string().max(20000).optional().nullable(),
  order_index: orderIndex.optional(),
});
export const updateLessonSchema = createLessonSchema.omit({ module_id: true }).partial();
export const updateAssignmentSchema = z.object({ assignment: z.string().max(20000).nullable() });

export const questionSchema = z
  .object({
    question: z.string().trim().min(1).max(1000),
    options: z.array(z.string().trim().min(1).max(300)).min(2).max(8),
    answer: z.coerce.number().int().min(0),
    order_index: orderIndex.optional(),
  })
  .refine((v) => v.answer < v.options.length, { path: ['answer'], message: 'must point at one of the options' });
export const updateQuestionSchema = z
  .object({
    question: z.string().trim().min(1).max(1000),
    options: z.array(z.string().trim().min(1).max(300)).min(2).max(8),
    answer: z.coerce.number().int().min(0),
    order_index: orderIndex,
  })
  .partial()
  .refine((v) => v.options === undefined || v.answer === undefined || v.answer < v.options.length, {
    path: ['answer'],
    message: 'must point at one of the options',
  });

export const courseIdParam = z.object({ courseId: uuid });
export const moduleIdParam = z.object({ moduleId: uuid });
export const questionIdParam = z.object({ questionId: uuid });

// ── Blog ─────────────────────────────────────────────────────────────────────

const blogBase = z.object({
  title: z.string().trim().min(1).max(255),
  excerpt: optText(500),
  content: z.string().min(1).max(200000),
  featured_image: z.string().trim().url().max(500).optional().nullable().or(z.literal('')),
  category_id: uuid.optional().nullable(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(15).optional(),
});
export const createPostSchema = blogBase;
export const updatePostSchema = blogBase.partial();
export const createCategorySchema = z.object({ name: z.string().trim().min(1).max(100), description: optText(500) });

export const postIdParam = z.object({ postId: uuid });
export const slugParam = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,200}$/i, 'is invalid') });
export const postsQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  category: z.string().max(100).optional(),
  tag: z.string().max(100).optional(),
  search: z.string().max(100).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
});
export const relatedQuery = z.object({ limit: z.coerce.number().int().min(1).max(10).optional() });

// ── Testimonials ─────────────────────────────────────────────────────────────

export const createTestimonialSchema = z.object({
  kid_id: uuid,
  rating: z.coerce.number().int().min(1).max(5),
  title: optText(150),
  content: z.string().trim().min(10).max(2000),
  child_name: optText(60),
  child_age: z.coerce.number().int().min(3).max(19).optional().nullable(),
  achievement: optText(300),
});
export const updateTestimonialSchema = z
  .object({
    rating: z.coerce.number().int().min(1).max(5),
    title: optText(150),
    content: z.string().trim().min(10).max(2000),
    achievement: optText(300),
  })
  .partial();
export const testimonialIdParam = z.object({ testimonialId: uuid });
export const adminNoteSchema = z.object({ admin_note: optText(500) });
export const testimonialsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(100000).optional(),
  featured: z.enum(['true', 'false']).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});

// ── Pricing & coupons (admin) ────────────────────────────────────────────────
// These objects are used to build UPDATE statements, so unknown keys MUST be dropped:
// only the columns listed here can ever reach the SQL.

const cycle = z.enum(['monthly', 'termly', 'once-off']);

const planBase = z.object({
  name: z.string().trim().min(1).max(100),
  billing_cycle: cycle,
  price: z.coerce.number().positive().max(1_000_000),
  original_price: z.coerce.number().positive().max(1_000_000).optional().nullable(),
  duration_months: z.coerce.number().int().min(0).max(36),
  savings_percent: z.coerce.number().min(0).max(100).optional().nullable(),
  badge: optText(50),
  features: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  is_active: z.boolean().optional(),
  sort_order: z.coerce.number().int().min(0).max(1000).optional(),
});
export const createPlanSchema = planBase;
export const updatePlanSchema = planBase.partial().refine((v) => Object.keys(v).length > 0, 'nothing to update');

const couponBase = z.object({
  code: z.string().trim().min(3).max(50).regex(/^[A-Za-z0-9_-]+$/, 'letters, numbers, - and _ only'),
  description: optText(300),
  discount_type: z.enum(['percentage', 'fixed']),
  discount_value: z.coerce.number().positive().max(1_000_000),
  applies_to: z.enum(['first_month', 'all_months', 'once']),
  min_months: z.coerce.number().int().min(0).max(36).optional().nullable(),
  max_uses: z.coerce.number().int().min(1).max(1_000_000).optional().nullable(),
  valid_from: z.string().max(40).optional().nullable(),
  valid_until: z.string().max(40).optional().nullable(),
  is_active: z.boolean().optional(),
});
export const createCouponSchema = couponBase.refine(
  (v) => v.discount_type !== 'percentage' || v.discount_value <= 100,
  { path: ['discount_value'], message: 'a percentage cannot be more than 100' }
);
export const updateCouponSchema = couponBase.omit({ code: true }).partial().refine((v) => Object.keys(v).length > 0, 'nothing to update');
export const validateCouponSchema = z.object({
  code: z.string().trim().min(1).max(50),
  billing_cycle: cycle,
  plan_id: uuid,
});
export const planIdParam = z.object({ planId: uuid });
export const couponIdParam = z.object({ couponId: uuid });

// ── Users (admin) ────────────────────────────────────────────────────────────

export const userIdParam = z.object({ userId: uuid });
export const updateRoleSchema = z.object({ role: z.enum(['admin', 'parent']) });

// ── Manual payment entry (admin) ─────────────────────────────────────────────

export const manualPaymentSchema = z.object({
  enrollment_id: uuid,
  amount: z.coerce.number().positive().max(1_000_000),
  method: z.enum(['cash', 'bank', 'cheque', 'other']),
  reference: optText(100),
  description: optText(300),
  date: z.string().max(40).optional().nullable(),
});
export const paymentKidParam = z.object({ kidId: uuid });
export const paymentIdParam = z.object({ paymentId: uuid });
export const enrollmentKidParam = z.object({ kidId: uuid });
