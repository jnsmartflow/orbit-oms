-- Sampling Library — add deliveryNumber column to usage log (Phase 3)
-- Date: 2026-05-22
-- Run in: Supabase SQL Editor (never prisma db push)
--
-- Adds a nullable delivery-number column so Phase 3 can backfill the
-- in-house delivery reference for historical tinting rows. Legacy rows
-- stay NULL.
--
-- Additive only — column is nullable, no defaults rewritten, no data
-- modified. Safe to re-run (IF NOT EXISTS on both statements).

ALTER TABLE sampling_usage_log
  ADD COLUMN IF NOT EXISTS "deliveryNumber" TEXT;

CREATE INDEX IF NOT EXISTS idx_sampling_usage_log_delivery_no
  ON sampling_usage_log ("deliveryNumber");

-- ── Verification (run manually after ALTER) ────────────────────────────────
-- \d sampling_usage_log
-- SELECT COUNT(*) FILTER (WHERE "deliveryNumber" IS NULL) AS unfilled,
--        COUNT(*) FILTER (WHERE "deliveryNumber" IS NOT NULL) AS filled
--   FROM sampling_usage_log;
