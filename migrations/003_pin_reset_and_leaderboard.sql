-- 003_pin_reset_and_leaderboard.sql
-- Additive only. Safe to run more than once.

-- A parent must choose a new PIN (set by scripts/force-pin-reset.js, cleared when a PIN is set).
ALTER TABLE kids ADD COLUMN IF NOT EXISTS pin_reset_required boolean NOT NULL DEFAULT false;

-- Leaderboards are opt-in, chosen by the parent. Default: off for every child.
ALTER TABLE kids ADD COLUMN IF NOT EXISTS leaderboard_opt_in boolean NOT NULL DEFAULT false;
