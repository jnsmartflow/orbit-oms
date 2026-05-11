-- Add "section" column to mo_order_form_index_v2 — drives the 6-section
-- grouping (INTERIORS, EXTERIORS, ENAMELS, WOODCARE, UTILITY, MULTI-USE)
-- on /place-order family card grid.
--
-- Schema approach: data-driven (DB column), not a hardcoded TS map.
-- Per locked decisions for this prompt:
--   - Column is TEXT NOT NULL — but no SQL-level default. The seed script
--     (scripts/v2-catalog-seed-from-preview.ts) sets section explicitly for
--     every row via FAMILY_TO_SECTION. Reseed-and-overwrite is the safety
--     guarantee for future families.
--   - 6 sections, family assignments locked in the prompt and mirrored in
--     the seed script's FAMILY_TO_SECTION constant.
--
-- See: docs/prompts/drafts/session-end-2026-05-10-recovery-and-branch-hygiene.md
--
-- Run in Supabase SQL Editor. Idempotent — re-running is safe:
--   - ADD COLUMN IF NOT EXISTS — silent no-op on existing column
--   - UPDATE re-applies the same family→section mapping (no-op semantically)
--   - SET NOT NULL is a no-op when the column is already NOT NULL

-- ── Optional rollback block (commented out for safety) ───────────────────
-- ALTER TABLE mo_order_form_index_v2 DROP COLUMN IF EXISTS "section";

-- ── 1. Add the column (nullable initially so the UPDATE has somewhere to land) ─
ALTER TABLE mo_order_form_index_v2
  ADD COLUMN IF NOT EXISTS "section" TEXT;

-- ── 2. Backfill section for every row, derived from family ───────────────
-- Section order top-to-bottom on /place-order:
--   INTERIORS → EXTERIORS → ENAMELS → WOODCARE → UTILITY → MULTI-USE
-- Family lists below match the locked decisions in the prompt verbatim.
-- ELSE NULL surfaces any unmapped family at the SET NOT NULL step below.
UPDATE mo_order_form_index_v2 SET "section" = CASE
  WHEN "family" IN ('VT GLO', 'VT ETERNA', 'VT SPECIALTY', 'SUPERCLEAN', 'SUPERCOVER', 'PROMISE INTERIOR')
    THEN 'INTERIORS'
  WHEN "family" IN ('MAX', 'POWERFLEXX', 'PROTECT', 'RAINPROOF', 'HISHEEN', 'TILE', 'TEXTURE', 'METALLIC', 'PROMISE EXTERIOR')
    THEN 'EXTERIORS'
  WHEN "family" IN ('GLOSS', 'SATIN', 'LUSTRE', 'PROMISE ENAMEL')
    THEN 'ENAMELS'
  WHEN "family" IN ('LUXURIO', '2K PU', 'PU PRIME', 'NC', 'MELAMINE', 'WOOD STAIN', 'WOOD FILLER')
    THEN 'WOODCARE'
  WHEN "family" IN ('AQUATECH', 'FLOOR PLUS', 'PRIMER', 'DISTEMPER', 'PUTTY', 'STAINER', 'SMOOTHOVER')
    THEN 'UTILITY'
  WHEN "family" IN ('PROMISE')
    THEN 'MULTI-USE'
  ELSE NULL
END;

-- ── 3. Lock the column to NOT NULL ───────────────────────────────────────
-- If any row still has section=NULL after the UPDATE above, this step will
-- fail with a clear error pointing at the unmapped family. That's the
-- intended safety net — rejects schema drift loudly.
ALTER TABLE mo_order_form_index_v2
  ALTER COLUMN "section" SET NOT NULL;

-- ── 4. Verification ──────────────────────────────────────────────────────
-- Expected output: 6 rows (one per section), counts roughly matching the
-- family distribution in the v2 catalog (455 rows total across sections).
SELECT "section", COUNT(*) AS row_count
FROM mo_order_form_index_v2
GROUP BY "section"
ORDER BY "section";
