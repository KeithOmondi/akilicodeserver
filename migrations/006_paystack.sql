-- 006_paystack.sql
-- ADDITIVE ONLY: one new column and one index. Drops nothing. Safe to run more than once.

-- Our own reference for a Paystack payment (the one we send to Paystack). It can exist only once,
-- which is what makes processing the same payment twice impossible at the database level.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS paystack_reference varchar(100);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_paystack_reference
  ON payments (paystack_reference) WHERE paystack_reference IS NOT NULL;
