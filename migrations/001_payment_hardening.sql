-- 001_payment_hardening.sql
-- ADDITIVE ONLY: adds columns, indexes and one new table. Drops nothing.
-- Safe to run more than once.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS checkout_request_id  varchar(100),
  ADD COLUMN IF NOT EXISTS merchant_request_id  varchar(100),
  ADD COLUMN IF NOT EXISTS phone                varchar(15),
  ADD COLUMN IF NOT EXISTS mpesa_receipt        varchar(50),
  ADD COLUMN IF NOT EXISTS source               varchar(10) NOT NULL DEFAULT 'stk',
  ADD COLUMN IF NOT EXISTS verified_at          timestamptz,
  ADD COLUMN IF NOT EXISTS result_code          integer,
  ADD COLUMN IF NOT EXISTS result_desc          text,
  ADD COLUMN IF NOT EXISTS review_reason        text;

-- Existing pending STK rows stored the CheckoutRequestID in `reference`.
UPDATE payments
   SET checkout_request_id = reference
 WHERE status = 'pending' AND checkout_request_id IS NULL AND method = 'M-Pesa';

-- A CheckoutRequestID and an M-Pesa receipt can each exist only once.
-- This is what makes processing idempotent at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_checkout_request_id
  ON payments (checkout_request_id) WHERE checkout_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_mpesa_receipt
  ON payments (mpesa_receipt) WHERE mpesa_receipt IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_status_created
  ON payments (status, created_at);

-- Every request that hits a Safaricom-facing URL is logged here.
CREATE TABLE IF NOT EXISTS payment_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source               varchar(20)  NOT NULL,   -- stk_callback | c2b_confirm | c2b_validate | stk_query
  outcome              varchar(40)  NOT NULL,   -- e.g. completed, failed, duplicate, unknown_checkout, bad_secret, ip_blocked
  ip                   varchar(64),
  checkout_request_id  varchar(100),
  mpesa_receipt        varchar(50),
  payload              jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_events_checkout ON payment_events (checkout_request_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_created  ON payment_events (created_at);
