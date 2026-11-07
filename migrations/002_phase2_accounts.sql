-- 002_phase2_accounts.sql
-- Phone sign-up / OTP, parental consent, screen time, short payment references.
-- Additive, except that it LOOSENS two NOT NULL rules on users (email, password)
-- so a parent can sign up with a phone number alone. Drops no data.
-- Safe to run more than once.

-- ── Parents may have a phone and no email (or the reverse) ─────────────────
ALTER TABLE users ALTER COLUMN email    DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified    boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;
-- A parent must be reachable by at least one method.
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_contact_check CHECK (email IS NOT NULL OR phone IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── One-time codes sent by SMS (only a keyed hash of the code is stored) ──
CREATE TABLE IF NOT EXISTS otp_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       varchar(20) NOT NULL,
  purpose     varchar(10) NOT NULL CHECK (purpose IN ('signup','login','gate')),
  code_hash   varchar(64) NOT NULL,
  attempts    integer     NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  ip          varchar(64),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_phone_created ON otp_codes (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_otp_created       ON otp_codes (created_at);

-- ── Verifiable parental consent, recorded before a child profile exists ────
CREATE TABLE IF NOT EXISTS parental_consents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kid_id         uuid REFERENCES kids(id) ON DELETE SET NULL, -- proof of consent survives a deletion request
  policy_version varchar(30) NOT NULL,
  is_guardian    boolean NOT NULL,             -- parent confirmed they are the parent / legal guardian and 18+
  items          jsonb   NOT NULL,             -- exactly what was agreed to
  ip             varchar(64),
  user_agent     text,
  accepted_at    timestamptz NOT NULL DEFAULT now(),
  withdrawn_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_consents_parent ON parental_consents (parent_id);
CREATE INDEX IF NOT EXISTS idx_consents_kid    ON parental_consents (kid_id);

-- ── Child profile: minimal data + parent-set screen time ───────────────────
ALTER TABLE kids ADD COLUMN IF NOT EXISTS birth_year               integer CHECK (birth_year BETWEEN 2000 AND 2100);
ALTER TABLE kids ADD COLUMN IF NOT EXISTS screen_time_daily_minutes integer CHECK (screen_time_daily_minutes BETWEEN 0 AND 1440); -- NULL = no limit
ALTER TABLE kids ADD COLUMN IF NOT EXISTS break_every_minutes       integer NOT NULL DEFAULT 30 CHECK (break_every_minutes BETWEEN 5 AND 180);

CREATE TABLE IF NOT EXISTS kid_usage_daily (
  kid_id    uuid NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
  day       date NOT NULL,                       -- Africa/Nairobi calendar day
  seconds   integer NOT NULL DEFAULT 0,
  last_beat timestamptz,
  PRIMARY KEY (kid_id, day)
);

-- ── Short, typeable payment reference (Paybill account number) ─────────────
-- Existing rows get a value automatically. Format: AK + 6 letters/digits.
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS pay_ref varchar(12)
  DEFAULT ('AK' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_enrollments_pay_ref ON enrollments (pay_ref);
