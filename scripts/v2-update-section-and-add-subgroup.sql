-- Iteration on /place-order section grouping (May 2026 CSV review).
-- Two operations bundled in one script:
--
--   1. Reassign FLOOR PLUS and SMOOTHOVER from UTILITY → EXTERIORS
--      (operator-aligned ordering: floor coatings + finishing prep both
--      live with mass exterior emulsions on the depot floor).
--
--   2. Add a "subgroup" column to mo_order_form_index_v2 — TEXT NOT NULL —
--      and backfill from a 34-family CASE block. Subgroup is a within-
--      section visual cluster label (no UI text label rendered; cards
--      separated by row-break on subgroup change). Stored data-driven so
--      future surfaces (MIS reports, /order migration, search/filter,
--      analytics) don't need a parallel TS map.
--
-- See: docs/prompts/drafts/code-update-2026-05-11-section-subgroup-iteration.md
--
-- Run in Supabase SQL Editor. Idempotent — re-running is safe:
--   - The section UPDATE re-applies the same WHERE clause + same value
--   - ADD COLUMN IF NOT EXISTS is a silent no-op on existing column
--   - The subgroup UPDATE re-applies the same family→subgroup mapping
--   - SET NOT NULL is a no-op when the constraint already exists

-- ── Optional rollback block (commented out for safety) ───────────────────
-- ALTER TABLE mo_order_form_index_v2 DROP COLUMN IF EXISTS "subgroup";
-- UPDATE mo_order_form_index_v2 SET "section" = 'UTILITY' WHERE "family" IN ('FLOOR PLUS', 'SMOOTHOVER');

-- ── 1. Reassign FLOOR PLUS + SMOOTHOVER to EXTERIORS ─────────────────────
UPDATE mo_order_form_index_v2
SET "section" = 'EXTERIORS'
WHERE "family" IN ('FLOOR PLUS', 'SMOOTHOVER');

-- ── 2A. Add subgroup column (nullable initially so the UPDATE has somewhere to land) ─
ALTER TABLE mo_order_form_index_v2
  ADD COLUMN IF NOT EXISTS "subgroup" TEXT;

-- ── 2B. Backfill subgroup for every row, derived from family ─────────────
-- Subgroup names are within-section visual cluster labels. They MAY repeat
-- across sections (e.g. "Prep – putty" appears under both UTILITY/PUTTY and
-- EXTERIORS/SMOOTHOVER) — render logic only checks subgroup changes WITHIN
-- a section, so cross-section repetition is harmless.
-- Two names use a Unicode en-dash (U+2013, "–") not an ASCII hyphen.
-- ELSE NULL surfaces any unmapped family at the SET NOT NULL step below.
UPDATE mo_order_form_index_v2 SET "subgroup" = CASE
  -- UTILITY
  WHEN "family" = 'STAINER'           THEN 'Tinting'
  WHEN "family" = 'PRIMER'            THEN 'Prep – primers'
  WHEN "family" = 'DISTEMPER'         THEN 'Mass distemper'
  WHEN "family" = 'AQUATECH'          THEN 'Waterproofing & decorative'
  WHEN "family" = 'PUTTY'             THEN 'Prep – putty'
  -- INTERIORS
  WHEN "family" = 'PROMISE INTERIOR'  THEN 'Promise (use-case interior)'
  WHEN "family" = 'VT GLO'            THEN 'VT (Dulux Velvet Touch)'
  WHEN "family" = 'VT ETERNA'         THEN 'VT (Dulux Velvet Touch)'
  WHEN "family" = 'VT SPECIALTY'      THEN 'VT (Dulux Velvet Touch)'
  WHEN "family" = 'SUPERCLEAN'        THEN 'Mass-market emulsion'
  WHEN "family" = 'SUPERCOVER'        THEN 'Mass-market emulsion'
  -- EXTERIORS
  WHEN "family" = 'PROMISE EXTERIOR'  THEN 'Mid Tier Exterior Emulsion'
  WHEN "family" = 'MAX'               THEN 'Mass exterior emulsion'
  WHEN "family" = 'PROTECT'           THEN 'Mass exterior emulsion'
  WHEN "family" = 'POWERFLEXX'        THEN 'Mass exterior emulsion'
  WHEN "family" = 'RAINPROOF'         THEN 'Mass exterior emulsion'
  WHEN "family" = 'HISHEEN'           THEN 'Specialty exterior'
  WHEN "family" = 'FLOOR PLUS'        THEN 'Floor coatings'
  WHEN "family" = 'TILE'              THEN 'Specialty exterior'
  WHEN "family" = 'SMOOTHOVER'        THEN 'Prep – putty'
  WHEN "family" = 'METALLIC'          THEN 'Specialty exterior'
  WHEN "family" = 'TEXTURE'           THEN 'Specialty exterior'
  -- ENAMELS
  WHEN "family" = 'GLOSS'             THEN 'Enamel finish (gloss)'
  WHEN "family" = 'SATIN'             THEN 'Enamel finish (satin)'
  WHEN "family" = 'PROMISE ENAMEL'    THEN 'Promise (use-case enamel)'
  WHEN "family" = 'LUSTRE'            THEN 'Enamel finish (lustre)'
  -- WOODCARE
  WHEN "family" = 'LUXURIO'           THEN 'Sadolin Premium PU'
  WHEN "family" = '2K PU'             THEN 'Sadolin Premium PU'
  WHEN "family" = 'PU PRIME'          THEN 'Sadolin Premium PU'
  WHEN "family" = 'NC'                THEN 'Sadolin Standard Woodcare'
  WHEN "family" = 'MELAMINE'          THEN 'Sadolin Standard Woodcare'
  WHEN "family" = 'WOOD FILLER'       THEN 'Wood finishing'
  WHEN "family" = 'WOOD STAIN'        THEN 'Wood finishing'
  -- MULTI-USE
  WHEN "family" = 'PROMISE'           THEN 'Promise umbrella'
  ELSE NULL
END;

-- ── 2C. Lock the subgroup column to NOT NULL ─────────────────────────────
-- If any row still has subgroup=NULL after the UPDATE above, this step
-- will fail with a clear error pointing at the unmapped family.
ALTER TABLE mo_order_form_index_v2
  ALTER COLUMN "subgroup" SET NOT NULL;

-- ── 3. Verification ──────────────────────────────────────────────────────
-- (a) Section breakdown after FLOOR PLUS + SMOOTHOVER reassignment.
--     Expected: UTILITY drops by ~ rows of those two families;
--     EXTERIORS gains the same.
SELECT "section", COUNT(*) AS row_count
FROM mo_order_form_index_v2
GROUP BY "section"
ORDER BY "section";

-- (b) Subgroup breakdown — 18 distinct subgroup labels expected
--     (some labels repeat across sections; DISTINCT in SQL counts each
--     section/subgroup pair separately when grouped only on subgroup).
SELECT "subgroup", COUNT(*) AS row_count
FROM mo_order_form_index_v2
GROUP BY "subgroup"
ORDER BY "subgroup";

-- (c) Coverage check — MUST return 0. Any positive count means a family
--     slipped through unmapped and the SET NOT NULL above already errored.
SELECT COUNT(*) AS unmapped_rows
FROM mo_order_form_index_v2
WHERE "subgroup" IS NULL;
