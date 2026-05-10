-- v2 parallel catalog table for the 33-family taxonomy.
--
-- Drives /place-order under the May 6 redesign. Live mo_order_form_index
-- continues to drive /order (mobile). After /place-order is approved on v2,
-- /order will switch to v2 and the legacy table can be dropped.
--
-- See: docs/prompts/drafts/session-end-2026-05-10-recovery-and-branch-hygiene.md
--
-- Run in Supabase SQL Editor. Idempotent — re-running is safe (CREATE
-- TABLE IF NOT EXISTS + named UNIQUE constraint).
--
-- For a clean rebuild during dev, uncomment the DROP TABLE block below
-- before re-running. Live data is reseeded by
-- scripts/v2-catalog-seed-from-preview.ts so destruction here is recoverable.

-- ── Optional clean rebuild (commented out for safety) ────────────────────
-- DROP TABLE IF EXISTS mo_order_form_index_v2;

-- ── Create table ─────────────────────────────────────────────────────────
-- Column shape mirrors live mo_order_form_index exactly. NO subVariant,
-- NO variant. All camelCase identifiers double-quoted to preserve case
-- (per CLAUDE_CORE.md §3 — Supabase columns are camelCase, no @map).
CREATE TABLE IF NOT EXISTS mo_order_form_index_v2 (
  "id"           SERIAL    PRIMARY KEY,
  "family"       TEXT      NOT NULL,
  "subProduct"   TEXT      NOT NULL,
  "baseColour"   TEXT      NULL,
  "displayName"  TEXT      NOT NULL,
  "searchTokens" TEXT      NOT NULL,
  "tinterType"   TEXT      NULL,
  "productType"  TEXT      NULL     DEFAULT 'PLAIN',
  "sortOrder"    INTEGER   NOT NULL DEFAULT 0,
  "isActive"     BOOLEAN   NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP NOT NULL DEFAULT now(),

  CONSTRAINT mo_order_form_index_v2_family_subproduct_basecolour_key
    UNIQUE ("family", "subProduct", "baseColour")
);

-- ── Verification ─────────────────────────────────────────────────────────
-- Expected on first run: 0 rows. Seed script
-- (scripts/v2-catalog-seed-from-preview.ts) populates the table next.
SELECT COUNT(*) AS row_count FROM mo_order_form_index_v2;
