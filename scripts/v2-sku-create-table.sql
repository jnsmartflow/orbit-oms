-- v2 SKU lookup table — parallel mirror of mo_sku_lookup with v2 taxonomy
-- (clean family + subProduct names matching mo_order_form_index_v2).
--
-- Drives /place-order via /api/place-order/data. Live mo_sku_lookup continues
-- to drive /order (mobile), the parser, and enrichment — untouched here.
--
-- Same column shape as legacy mo_sku_lookup (prisma/schema.prisma lines
-- 1113–1128). Per locked decisions in this prompt:
--   - product  = v2 subProduct (clean name, e.g. "MATT" not "LUXURIO PU MATT")
--   - category = v2 family    (clean name, e.g. "LUXURIO" not "SADOLIN")
--   - Other columns unchanged from legacy (description, packCode, unit, …)
--   - Cross-listed rows: material = ${material}-${family_with_underscores}
--     for the 2nd/3rd copy; first copy keeps original material
--   - Hidden families (AUTO/DUCO/M900/SPRAY PAINT/5IN1/TOOLS) and 4 single-
--     row orphans are NOT inserted
--   - STAINER family rows preserve legacy inverted shape (product=colour
--     code) — handled by custom join logic in /api/place-order/data
--
-- See: docs/prompts/drafts/session-end-2026-05-10-recovery-and-branch-hygiene.md
--
-- Run in Supabase SQL Editor. Idempotent — re-running is safe.
-- For a clean rebuild during dev, uncomment the DROP TABLE block below.

-- ── Optional clean rebuild (commented out for safety) ────────────────────
-- DROP TABLE IF EXISTS mo_sku_lookup_v2;

-- ── Create table ─────────────────────────────────────────────────────────
-- Column shape mirrors live mo_sku_lookup exactly. baseColour is NOT NULL
-- here — same as legacy, and different from mo_order_form_index_v2 where
-- it's nullable. All camelCase identifiers double-quoted to preserve case
-- (per CLAUDE_CORE.md §3 — Supabase columns are camelCase, no @map).
CREATE TABLE IF NOT EXISTS mo_sku_lookup_v2 (
  "id"              SERIAL    PRIMARY KEY,
  "material"        TEXT      NOT NULL,
  "description"     TEXT      NOT NULL,
  "category"        TEXT      NOT NULL,
  "product"         TEXT      NOT NULL,
  "baseColour"      TEXT      NOT NULL,
  "packCode"        TEXT      NOT NULL,
  "unit"            TEXT      NULL,
  "refMaterial"     TEXT      NULL,
  "refDescription"  TEXT      NULL,
  "paintType"       TEXT      NULL,
  "materialType"    TEXT      NULL,
  "piecesPerCarton" INTEGER   NULL,
  "createdAt"       TIMESTAMP NOT NULL DEFAULT now(),

  CONSTRAINT mo_sku_lookup_v2_material_key UNIQUE ("material")
);

-- ── Verification ─────────────────────────────────────────────────────────
-- Expected on first run: 0 rows. Seed script
-- (scripts/v2-sku-seed-from-legacy.ts) populates the table next.
SELECT COUNT(*) AS row_count FROM mo_sku_lookup_v2;
