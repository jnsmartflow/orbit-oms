-- Sampling Library — REPAIR schema patch (step REPAIR-1)
-- Spec: see prompt step REPAIR-1
-- Date: 2026-05-22
-- Run in: Supabase SQL Editor (never prisma db push)
--
-- This patch is ADDITIVE only. It does NOT drop columns, modify existing
-- column types, or touch existing data. Safe to re-run (every statement is
-- IF NOT EXISTS).
--
-- Fixes addressed by the matching script (scripts/repair-sampling-import.ts):
--   1. createdAt currently = today's date → reset to earliest Excel usage date
--   2. siteNameRaw + siteId never populated → backfill from Excel SITE NAME
--   4. Usage history was collapsed → re-explode rows into sampling_usage_log
-- (fix 3 is a UI-only change handled by a separate prompt)

-- ── 1. Add siteNameRaw column to sampling_register ──────────────────────────
-- Used when the Excel site name does NOT match a delivery_point_master row.
-- When a master match is found, this column stays NULL and siteId is set.

ALTER TABLE sampling_register
  ADD COLUMN IF NOT EXISTS "siteNameRaw" TEXT;

-- ── 2. Create sampling_usage_log table ──────────────────────────────────────
-- One row per IMPORT row in the source Excel — preserves the per-tinting
-- audit history that the v1 import collapsed into recipes. recipeId is
-- nullable because some Excel rows may not have a clean (sku, pack) match
-- to an existing recipe variant; we still want the activity logged.

CREATE TABLE IF NOT EXISTS sampling_usage_log (
  "id"               SERIAL        PRIMARY KEY,
  "samplingNo"       INTEGER       NOT NULL REFERENCES sampling_register("samplingNo") ON DELETE CASCADE,
  "recipeId"         INTEGER       REFERENCES sampling_recipes(id) ON DELETE SET NULL,
  "usageDate"        DATE,
  "operatorId"       INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  "operatorNameRaw"  TEXT,
  "tinQty"           DECIMAL(10,3) NOT NULL DEFAULT 0,
  "dealerNameRaw"    TEXT,
  "siteNameRaw"      TEXT,
  "skuCodeRaw"       TEXT,
  "packCode"         "PackCode",
  "sourceRowIndex"   INTEGER,
  "createdAt"        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── 3. Indexes ──────────────────────────────────────────────────────────────
-- Read patterns:
--   - timeline view per shade  → (samplingNo, usageDate DESC)
--   - "what did operator X tint" → (operatorId, usageDate)
--   - site filter on unmatched names → (siteNameRaw)

CREATE INDEX IF NOT EXISTS idx_sampling_usage_log_sampling
  ON sampling_usage_log ("samplingNo");
CREATE INDEX IF NOT EXISTS idx_sampling_usage_log_sampling_date
  ON sampling_usage_log ("samplingNo", "usageDate" DESC);
CREATE INDEX IF NOT EXISTS idx_sampling_usage_log_operator_date
  ON sampling_usage_log ("operatorId", "usageDate");
CREATE INDEX IF NOT EXISTS idx_sampling_usage_log_site
  ON sampling_usage_log ("siteNameRaw");

-- ── Verification (run manually after CREATE) ───────────────────────────────
-- SELECT COUNT(*) FROM sampling_register;                                       -- expected: ~3566
-- SELECT COUNT(*) FROM sampling_register WHERE "siteNameRaw" IS NULL;           -- expected: 3566 BEFORE repair, < 3566 AFTER
-- SELECT COUNT(*) FROM sampling_register WHERE "siteId" IS NULL;                -- decreases as sites are matched
-- SELECT COUNT(*) FROM sampling_usage_log;                                      -- 0 BEFORE repair, ~14k AFTER
-- \d sampling_usage_log
