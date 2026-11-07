-- Reconstructed from the live database catalog (read-only).
-- Generated 2026-11-06T10:32:50.006Z

CREATE SEQUENCE IF NOT EXISTS testimonial_stats_id_seq;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid NOT NULL,
  action character varying(100) NOT NULL,
  user_id uuid,
  details jsonb,
  ip_address character varying(45),
  user_agent text,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs USING btree (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created ON public.audit_logs USING btree (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS blog_categories (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name character varying(100) NOT NULL,
  slug character varying(100) NOT NULL,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT blog_categories_name_key UNIQUE (name),
  CONSTRAINT blog_categories_pkey PRIMARY KEY (id),
  CONSTRAINT blog_categories_slug_key UNIQUE (slug)
);
CREATE INDEX IF NOT EXISTS idx_blog_categories_slug ON public.blog_categories USING btree (slug);

CREATE TABLE IF NOT EXISTS blog_post_tags (
  post_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  CONSTRAINT blog_post_tags_pkey PRIMARY KEY (post_id, tag_id)
);

CREATE TABLE IF NOT EXISTS blog_posts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  title character varying(255) NOT NULL,
  slug character varying(255) NOT NULL,
  excerpt text,
  content text NOT NULL,
  featured_image character varying(500),
  author_id uuid NOT NULL,
  category_id uuid,
  status character varying(20) DEFAULT 'draft'::character varying,
  view_count integer DEFAULT 0,
  published_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT blog_posts_pkey PRIMARY KEY (id),
  CONSTRAINT blog_posts_slug_key UNIQUE (slug),
  CONSTRAINT blog_posts_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'published'::character varying, 'archived'::character varying])::text[])))
);
CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON public.blog_posts USING btree (slug);
CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON public.blog_posts USING btree (status);
CREATE INDEX IF NOT EXISTS idx_blog_posts_published_at ON public.blog_posts USING btree (published_at DESC);

CREATE TABLE IF NOT EXISTS blog_tags (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name character varying(50) NOT NULL,
  slug character varying(50) NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT blog_tags_name_key UNIQUE (name),
  CONSTRAINT blog_tags_pkey PRIMARY KEY (id),
  CONSTRAINT blog_tags_slug_key UNIQUE (slug)
);
CREATE INDEX IF NOT EXISTS idx_blog_tags_slug ON public.blog_tags USING btree (slug);

CREATE TABLE IF NOT EXISTS calendar_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  kid_id uuid NOT NULL,
  event_date date NOT NULL,
  event_type character varying(50) NOT NULL,
  lesson_id uuid,
  title text,
  points_earned integer,
  marks integer,
  status character varying(20),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT calendar_events_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_kid_date ON public.calendar_events USING btree (kid_id, event_date);

CREATE TABLE IF NOT EXISTS code_executions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  snippet_id uuid,
  code text NOT NULL,
  language character varying(20) NOT NULL,
  output text,
  error text,
  execution_time_ms integer,
  success boolean DEFAULT false,
  executed_at timestamp without time zone DEFAULT now(),
  CONSTRAINT code_executions_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_code_executions_snippet ON public.code_executions USING btree (snippet_id);

CREATE TABLE IF NOT EXISTS code_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  session_token character varying(255) NOT NULL,
  current_code text DEFAULT ''::text,
  current_language character varying(20) DEFAULT 'javascript'::character varying,
  cursor_position integer DEFAULT 0,
  selected_lines integer[],
  font_size integer DEFAULT 14,
  is_dark_mode boolean DEFAULT true,
  last_updated timestamp without time zone DEFAULT now(),
  CONSTRAINT code_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT code_sessions_session_token_key UNIQUE (session_token)
);
CREATE INDEX IF NOT EXISTS idx_code_sessions_user_id ON public.code_sessions USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_code_sessions_token ON public.code_sessions USING btree (session_token);

CREATE TABLE IF NOT EXISTS code_snippets (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  name character varying(255) NOT NULL,
  code text NOT NULL,
  language character varying(50) NOT NULL,
  description text,
  is_favorite boolean DEFAULT false,
  tags text[] DEFAULT '{}'::text[],
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  last_executed_at timestamp with time zone,
  execution_count integer DEFAULT 0,
  shared boolean DEFAULT false,
  share_token character varying(255),
  CONSTRAINT code_snippets_language_check CHECK (((language)::text = ANY ((ARRAY['javascript'::character varying, 'python'::character varying, 'html'::character varying, 'css'::character varying])::text[]))),
  CONSTRAINT code_snippets_pkey PRIMARY KEY (id),
  CONSTRAINT code_snippets_share_token_key UNIQUE (share_token)
);
CREATE INDEX IF NOT EXISTS idx_code_snippets_user_id ON public.code_snippets USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_code_snippets_language ON public.code_snippets USING btree (language);
CREATE INDEX IF NOT EXISTS idx_code_snippets_created_at ON public.code_snippets USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_code_snippets_shared ON public.code_snippets USING btree (shared);

CREATE TABLE IF NOT EXISTS coupons (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  code character varying(50) NOT NULL,
  description text,
  discount_type character varying(20) NOT NULL,
  discount_value numeric(10,2) NOT NULL,
  applies_to character varying(20) DEFAULT 'first_month'::character varying NOT NULL,
  min_months integer,
  max_uses integer,
  uses_count integer DEFAULT 0,
  valid_from timestamp without time zone DEFAULT now(),
  valid_until timestamp without time zone,
  is_active boolean DEFAULT true,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT coupons_applies_to_check CHECK (((applies_to)::text = ANY ((ARRAY['first_month'::character varying, 'all_months'::character varying, 'once'::character varying])::text[]))),
  CONSTRAINT coupons_code_key UNIQUE (code),
  CONSTRAINT coupons_discount_type_check CHECK (((discount_type)::text = ANY ((ARRAY['percentage'::character varying, 'fixed'::character varying])::text[]))),
  CONSTRAINT coupons_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS courses (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  title character varying(255) NOT NULL,
  description text,
  price numeric(10,2) NOT NULL,
  duration character varying(50),
  category character varying(100),
  image_url text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  trial_duration_days integer DEFAULT 3,
  is_trial_available boolean DEFAULT true,
  CONSTRAINT courses_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS enrollments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  kid_id uuid,
  parent_id uuid,
  course_name character varying(255) NOT NULL,
  fee_amount numeric(10,2) NOT NULL,
  billing_cycle character varying(20),
  start_date date DEFAULT CURRENT_DATE,
  status character varying(20) DEFAULT 'active'::character varying,
  created_at timestamp without time zone DEFAULT now(),
  next_payment_date date,
  payment_status character varying(20) DEFAULT 'pending'::character varying,
  last_payment_date timestamp with time zone,
  mpesa_receipt_number character varying(100),
  paid_at timestamp with time zone,
  payment_method character varying(50) DEFAULT 'mpesa'::character varying,
  transaction_id character varying(100),
  total_paid numeric(10,2) DEFAULT 0,
  course_id uuid,
  CONSTRAINT enrollments_billing_cycle_check CHECK (((billing_cycle)::text = ANY ((ARRAY['monthly'::character varying, 'termly'::character varying, 'once-off'::character varying])::text[]))),
  CONSTRAINT enrollments_payment_status_check CHECK (((payment_status)::text = ANY ((ARRAY['pending'::character varying, 'paid'::character varying, 'overdue'::character varying, 'cancelled'::character varying, 'once-off'::character varying])::text[]))),
  CONSTRAINT enrollments_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_enrollments_payment_status ON public.enrollments USING btree (payment_status);
CREATE INDEX IF NOT EXISTS idx_enrollments_kid_parent ON public.enrollments USING btree (kid_id, parent_id);

CREATE TABLE IF NOT EXISTS kid_badges (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  kid_id uuid NOT NULL,
  name text NOT NULL,
  icon text,
  points_awarded integer DEFAULT 0,
  earned_at timestamp with time zone DEFAULT now(),
  CONSTRAINT kid_badges_kid_id_name_key UNIQUE (kid_id, name),
  CONSTRAINT kid_badges_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS kid_progress (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  kid_id uuid NOT NULL,
  lesson_id uuid NOT NULL,
  enrollment_id uuid NOT NULL,
  completed boolean DEFAULT false,
  points_earned integer DEFAULT 0,
  code_submitted text,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT kid_progress_kid_id_lesson_id_enrollment_id_key UNIQUE (kid_id, lesson_id, enrollment_id),
  CONSTRAINT kid_progress_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_kid_progress_kid ON public.kid_progress USING btree (kid_id);
CREATE INDEX IF NOT EXISTS idx_kid_progress_lesson ON public.kid_progress USING btree (lesson_id);
CREATE INDEX IF NOT EXISTS idx_kid_progress_enrollment ON public.kid_progress USING btree (enrollment_id);

CREATE TABLE IF NOT EXISTS kids (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  parent_id uuid NOT NULL,
  name character varying(255) NOT NULL,
  age integer NOT NULL,
  grade character varying(50),
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  username text,
  pin_hash text,
  avatar text,
  total_points integer DEFAULT 0,
  streak_days integer DEFAULT 0,
  last_activity_date date,
  pin_failed_attempts integer DEFAULT 0,
  pin_locked_until timestamp without time zone,
  last_kid_login_at timestamp without time zone,
  last_kid_login_ip character varying(45),
  session_timeout_minutes integer DEFAULT 120,
  CONSTRAINT kids_age_check CHECK ((age >= 0)),
  CONSTRAINT kids_pkey PRIMARY KEY (id),
  CONSTRAINT kids_username_key UNIQUE (username)
);
CREATE INDEX IF NOT EXISTS idx_kids_parent_id ON public.kids USING btree (parent_id);

CREATE TABLE IF NOT EXISTS learning_calendar (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  kid_id uuid NOT NULL,
  activity_date date NOT NULL,
  lessons_completed integer DEFAULT 1,
  points_earned integer DEFAULT 0,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT learning_calendar_kid_id_activity_date_key UNIQUE (kid_id, activity_date),
  CONSTRAINT learning_calendar_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS lesson_questions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  lesson_id uuid NOT NULL,
  question text NOT NULL,
  options jsonb NOT NULL,
  answer integer NOT NULL,
  order_index integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT lesson_questions_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS lessons (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  module_id uuid NOT NULL,
  title text NOT NULL,
  notes text,
  language text,
  starter_code text,
  solution_code text,
  order_index integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  lesson_type character varying(20) DEFAULT 'notes'::character varying NOT NULL,
  expected_output text,
  code_snippets text,
  assignment text,
  assignment_due_date date,
  CONSTRAINT lessons_language_check CHECK ((language = ANY (ARRAY['javascript'::text, 'python'::text, 'html'::text, 'scratch'::text]))),
  CONSTRAINT lessons_lesson_type_check CHECK (((lesson_type)::text = ANY ((ARRAY['notes'::character varying, 'coding'::character varying, 'scratch'::character varying])::text[]))),
  CONSTRAINT lessons_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_lessons_module_id ON public.lessons USING btree (module_id);

CREATE TABLE IF NOT EXISTS modules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  course_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  order_index integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT modules_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_modules_course_id ON public.modules USING btree (course_id);

CREATE TABLE IF NOT EXISTS payments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  enrollment_id uuid,
  kid_id uuid,
  parent_id uuid,
  amount numeric(10,2) NOT NULL,
  method character varying(50) NOT NULL,
  reference character varying(255),
  description text,
  receipt_number character varying(100),
  status character varying(20) DEFAULT 'completed'::character varying,
  date date DEFAULT CURRENT_DATE,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT payments_pkey PRIMARY KEY (id),
  CONSTRAINT payments_receipt_number_key UNIQUE (receipt_number)
);
CREATE INDEX IF NOT EXISTS idx_payments_enrollment ON public.payments USING btree (enrollment_id);
CREATE INDEX IF NOT EXISTS idx_payments_parent ON public.payments USING btree (parent_id);

CREATE TABLE IF NOT EXISTS pricing_plans (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name character varying(100) NOT NULL,
  billing_cycle character varying(20) NOT NULL,
  price numeric(10,2) NOT NULL,
  original_price numeric(10,2),
  duration_months integer DEFAULT 1 NOT NULL,
  savings_percent numeric(5,2),
  badge character varying(50),
  features text[] DEFAULT '{}'::text[],
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT pricing_plans_billing_cycle_check CHECK (((billing_cycle)::text = ANY ((ARRAY['monthly'::character varying, 'termly'::character varying, 'once-off'::character varying])::text[]))),
  CONSTRAINT pricing_plans_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS submissions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  lesson_id uuid NOT NULL,
  kid_id uuid NOT NULL,
  parent_id uuid NOT NULL,
  enrollment_id uuid NOT NULL,
  github_url character varying(500) NOT NULL,
  status character varying(20) DEFAULT 'submitted'::character varying,
  marks integer,
  feedback text,
  submitted_at timestamp without time zone DEFAULT now(),
  reviewed_at timestamp without time zone,
  reviewed_by uuid,
  CONSTRAINT submissions_lesson_id_kid_id_key UNIQUE (lesson_id, kid_id),
  CONSTRAINT submissions_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS testimonial_stats (
  id integer DEFAULT nextval('testimonial_stats_id_seq'::regclass) NOT NULL,
  total_testimonials integer DEFAULT 0,
  average_rating numeric(3,2) DEFAULT 0,
  five_star_count integer DEFAULT 0,
  four_star_count integer DEFAULT 0,
  three_star_count integer DEFAULT 0,
  two_star_count integer DEFAULT 0,
  one_star_count integer DEFAULT 0,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT testimonial_stats_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS testimonials (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  parent_id uuid NOT NULL,
  kid_id uuid NOT NULL,
  enrollment_id uuid NOT NULL,
  rating integer NOT NULL,
  title character varying(200),
  content text NOT NULL,
  child_name character varying(100),
  child_age integer,
  achievement text,
  is_verified boolean DEFAULT false,
  is_featured boolean DEFAULT false,
  status character varying(20) DEFAULT 'pending'::character varying,
  admin_note text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT testimonials_pkey PRIMARY KEY (id),
  CONSTRAINT testimonials_rating_check CHECK (((rating >= 1) AND (rating <= 5))),
  CONSTRAINT testimonials_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[]))),
  CONSTRAINT unique_enrollment_testimonial UNIQUE (enrollment_id)
);
CREATE INDEX IF NOT EXISTS idx_testimonials_status ON public.testimonials USING btree (status);
CREATE INDEX IF NOT EXISTS idx_testimonials_parent ON public.testimonials USING btree (parent_id);
CREATE INDEX IF NOT EXISTS idx_testimonials_featured ON public.testimonials USING btree (is_featured) WHERE (is_featured = true);
CREATE INDEX IF NOT EXISTS idx_testimonials_rating ON public.testimonials USING btree (rating);

CREATE TABLE IF NOT EXISTS trial_access (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  kid_id uuid NOT NULL,
  course_id uuid NOT NULL,
  started_at timestamp with time zone DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  status character varying(20) DEFAULT 'active'::character varying,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT trial_access_pkey PRIMARY KEY (id),
  CONSTRAINT trial_access_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'expired'::character varying, 'converted'::character varying])::text[])))
);
CREATE INDEX IF NOT EXISTS idx_trial_access_kid_course ON public.trial_access USING btree (kid_id, course_id);
CREATE INDEX IF NOT EXISTS idx_trial_access_expires_at ON public.trial_access USING btree (expires_at);

CREATE TABLE IF NOT EXISTS users (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  name character varying(255) NOT NULL,
  email character varying(255) NOT NULL,
  phone character varying(20) NOT NULL,
  password text NOT NULL,
  role character varying(20) DEFAULT 'parent'::character varying NOT NULL,
  password_reset_otp character varying(255),
  otp_expires timestamp without time zone,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  is_verified boolean DEFAULT false,
  verification_token character varying(255),
  reset_password_token character varying(255),
  reset_password_expires timestamp without time zone,
  locked_until timestamp without time zone,
  last_login_at timestamp without time zone,
  last_login_ip character varying(45),
  two_factor_secret character varying(255),
  deletion_requested_at timestamp without time zone,
  deletion_completed_at timestamp without time zone,
  anonymized_at timestamp without time zone,
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_phone_key UNIQUE (phone),
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['admin'::character varying, 'parent'::character varying])::text[])))
);

-- Foreign keys are added last so table order does not matter.
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE blog_post_tags ADD CONSTRAINT blog_post_tags_post_id_fkey FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE;
ALTER TABLE blog_post_tags ADD CONSTRAINT blog_post_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES blog_tags(id) ON DELETE CASCADE;
ALTER TABLE blog_posts ADD CONSTRAINT blog_posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE blog_posts ADD CONSTRAINT blog_posts_category_id_fkey FOREIGN KEY (category_id) REFERENCES blog_categories(id) ON DELETE SET NULL;
ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_kid_id_fkey FOREIGN KEY (kid_id) REFERENCES kids(id) ON DELETE CASCADE;
ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES lessons(id);
ALTER TABLE code_executions ADD CONSTRAINT code_executions_snippet_id_fkey FOREIGN KEY (snippet_id) REFERENCES code_snippets(id) ON DELETE SET NULL;
ALTER TABLE code_sessions ADD CONSTRAINT code_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES kids(id) ON DELETE CASCADE;
ALTER TABLE code_snippets ADD CONSTRAINT code_snippets_user_id_fkey FOREIGN KEY (user_id) REFERENCES kids(id) ON DELETE CASCADE;
ALTER TABLE enrollments ADD CONSTRAINT enrollments_course_id_fkey FOREIGN KEY (course_id) REFERENCES courses(id);
ALTER TABLE enrollments ADD CONSTRAINT enrollments_kid_id_fkey FOREIGN KEY (kid_id) REFERENCES kids(id) ON DELETE CASCADE;
ALTER TABLE enrollments ADD CONSTRAINT enrollments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE kid_badges ADD CONSTRAINT kid_badges_kid_id_fkey FOREIGN KEY (kid_id) REFERENCES kids(id) ON DELETE CASCADE;
ALTER TABLE kid_progress ADD CONSTRAINT kid_progress_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE CASCADE;
ALTER TABLE kid_progress ADD CONSTRAINT kid_progress_kid_id_fkey FOREIGN KEY (kid_id) REFERENCES kids(id) ON DELETE CASCADE;
ALTER TABLE kid_progress ADD CONSTRAINT kid_progress_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE;
ALTER TABLE kids ADD CONSTRAINT fk_parent FOREIGN KEY (parent_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE learning_calendar ADD CONSTRAINT learning_calendar_kid_id_fkey FOREIGN KEY (kid_id) REFERENCES kids(id) ON DELETE CASCADE;
ALTER TABLE lesson_questions ADD CONSTRAINT lesson_questions_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE;
ALTER TABLE lessons ADD CONSTRAINT lessons_module_id_fkey FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE;
ALTER TABLE modules ADD CONSTRAINT modules_course_id_fkey FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
ALTER TABLE payments ADD CONSTRAINT payments_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE CASCADE;
ALTER TABLE payments ADD CONSTRAINT payments_kid_id_fkey FOREIGN KEY (kid_id) REFERENCES kids(id);
ALTER TABLE payments ADD CONSTRAINT payments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES users(id);
ALTER TABLE submissions ADD CONSTRAINT submissions_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES enrollments(id);
ALTER TABLE submissions ADD CONSTRAINT submissions_kid_id_fkey FOREIGN KEY (kid_id) REFERENCES kids(id) ON DELETE CASCADE;
ALTER TABLE submissions ADD CONSTRAINT submissions_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE;
ALTER TABLE submissions ADD CONSTRAINT submissions_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES users(id);
ALTER TABLE submissions ADD CONSTRAINT submissions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES users(id);
ALTER TABLE testimonials ADD CONSTRAINT testimonials_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE CASCADE;
ALTER TABLE testimonials ADD CONSTRAINT testimonials_kid_id_fkey FOREIGN KEY (kid_id) REFERENCES kids(id) ON DELETE CASCADE;
ALTER TABLE testimonials ADD CONSTRAINT testimonials_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE trial_access ADD CONSTRAINT trial_access_course_id_fkey FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
ALTER TABLE trial_access ADD CONSTRAINT trial_access_kid_id_fkey FOREIGN KEY (kid_id) REFERENCES kids(id) ON DELETE CASCADE;
