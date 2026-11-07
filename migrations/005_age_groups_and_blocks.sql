-- 005_age_groups_and_blocks.sql
-- Additive only. Safe to run more than once.
--
-- Age groups: every child belongs to one group, every lesson can say which groups it is for
-- (NULL = everyone), and a course can say where it sits in the learning path.
-- Block coding: a project can be a block (Scratch-style) project, not only HTML/CSS/JS.

-- Groups used everywhere: '4-6', '7-9', '10-12', '13-15', '16-18'
ALTER TABLE kids ADD COLUMN IF NOT EXISTS age_group varchar(10);

UPDATE kids SET age_group = CASE
    WHEN age <= 6  THEN '4-6'
    WHEN age <= 9  THEN '7-9'
    WHEN age <= 12 THEN '10-12'
    WHEN age <= 15 THEN '13-15'
    ELSE '16-18'
  END
 WHERE age_group IS NULL AND age IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kids_age_group_check') THEN
    ALTER TABLE kids ADD CONSTRAINT kids_age_group_check
      CHECK (age_group IS NULL OR age_group IN ('4-6','7-9','10-12','13-15','16-18'));
  END IF;
END $$;

-- NULL means "every group", so everything that exists today keeps showing to everyone.
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS age_groups text[];
ALTER TABLE courses ADD COLUMN IF NOT EXISTS age_groups text[];
-- Where a course sits in the path (1 = start here). Lower numbers first.
ALTER TABLE courses ADD COLUMN IF NOT EXISTS path_order integer NOT NULL DEFAULT 0;

-- Block (Scratch-style) projects keep their blocks as JSON.
ALTER TABLE kid_projects ADD COLUMN IF NOT EXISTS kind varchar(10) NOT NULL DEFAULT 'web';
ALTER TABLE kid_projects ADD COLUMN IF NOT EXISTS blocks jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kid_projects_kind_check') THEN
    ALTER TABLE kid_projects ADD CONSTRAINT kid_projects_kind_check CHECK (kind IN ('web','blocks'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_kids_age_group ON kids (age_group);
