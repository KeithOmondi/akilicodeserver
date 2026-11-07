-- 004_kid_projects.sql
-- Additive only. Safe to run more than once.
-- A child's coding projects (HTML, CSS and JavaScript). A project may belong to a lesson's assignment,
-- can be handed in for the teacher, and gets marks and feedback back.

CREATE TABLE IF NOT EXISTS kid_projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kid_id        uuid NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
  lesson_id     uuid REFERENCES lessons(id) ON DELETE SET NULL,
  enrollment_id uuid REFERENCES enrollments(id) ON DELETE SET NULL,
  title         varchar(80) NOT NULL DEFAULT 'My project',
  html          text NOT NULL DEFAULT '',
  css           text NOT NULL DEFAULT '',
  js            text NOT NULL DEFAULT '',
  submitted_at  timestamptz,
  marks         integer CHECK (marks IS NULL OR (marks >= 0 AND marks <= 100)),
  feedback      text,
  reviewed_at   timestamptz,
  reviewed_by   uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kid_projects_kid ON kid_projects (kid_id, updated_at DESC);
-- One project per child per assignment lesson.
CREATE UNIQUE INDEX IF NOT EXISTS uq_kid_projects_kid_lesson ON kid_projects (kid_id, lesson_id) WHERE lesson_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kid_projects_submitted ON kid_projects (submitted_at) WHERE submitted_at IS NOT NULL;
