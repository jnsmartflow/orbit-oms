-- ============================================================================
-- BUILD: sku_master_v2 (new FLAT catalog table)
-- 2026-07-19 · Schema v27.10 · OrbitOMS
--
-- Run in Supabase SQL Editor. Review Part 3 filter against the Step 1 list
-- before running.
--
-- Creates + fills the new flat table only. NO repoint of any module, NO change
-- to the old normalised sku_master, NO change to mo_sku_lookup_v2.
-- Prisma model + `npx prisma generate` is the NEXT session.
--
-- Supabase SQL Editor rules (CLAUDE_CORE.md §3):
--   - no BEGIN/COMMIT wrapper — run sequentially, stop on any error
--   - camelCase identifiers MUST be double-quoted
--   - never `prisma db push` / `db pull`; schema lands here, then hand-edit
--     schema.prisma to match, then `npx prisma generate`
--
-- Part 1 and Part 2 are NOT re-runnable (CREATE TABLE will error if it exists;
-- re-running Part 2 would double the rows — material UNIQUE will block it).
-- Part 3 and Part 4 are safe to re-run.
-- ============================================================================


-- ============================================================================
-- PART 1 — CREATE TABLE
-- Flat by design: no FKs, no helper tables. Column names match the intended
-- Prisma model exactly so the model needs no @map directives.
-- ============================================================================

CREATE TABLE "sku_master_v2" (
  id                 serial       PRIMARY KEY,
  material           text         NOT NULL UNIQUE,
  description        text         NOT NULL,
  category           text         NOT NULL,
  product            text         NOT NULL,
  "baseColour"       text         NOT NULL,
  "packCode"         text         NOT NULL,
  unit               text,
  "refMaterial"      text,
  "refDescription"   text,
  "paintType"        text,
  "materialType"     text,
  "piecesPerCarton"  int,
  "isPrimary"        boolean      NOT NULL DEFAULT true,
  "isActive"         boolean      NOT NULL DEFAULT true,
  "createdAt"        timestamptz  NOT NULL DEFAULT now(),
  "updatedAt"        timestamptz
);

-- Notes on the two flags — they answer DIFFERENT questions, keep them separate:
--   "isPrimary" = duplicate-twin flag (carried from mo_sku_lookup_v2).
--                 False = "another row is the one to show for this product".
--   "isActive"  = lifecycle flag (NEW on this table).
--                 False = "discontinued, no longer sellable stock".
-- containerType from the old sku_master is deliberately NOT carried — it had
-- no operational reader, only the retiring admin CRUD form.


-- ============================================================================
-- PART 2 — POUR mo_sku_lookup_v2 DATA IN
-- v2's `id` is deliberately NOT carried; the serial assigns fresh ids.
-- Every poured row starts "isActive" = true; Part 3 then retires the known set.
-- ============================================================================

INSERT INTO "sku_master_v2" (
  material,
  description,
  category,
  product,
  "baseColour",
  "packCode",
  unit,
  "refMaterial",
  "refDescription",
  "paintType",
  "materialType",
  "piecesPerCarton",
  "isPrimary",
  "isActive",
  "createdAt",
  "updatedAt"
)
SELECT
  material,
  description,
  category,
  product,
  "baseColour",
  "packCode",
  unit,
  "refMaterial",
  "refDescription",
  "paintType",
  "materialType",
  "piecesPerCarton",
  "isPrimary",
  true        AS "isActive",
  "createdAt",
  now()       AS "updatedAt"
FROM mo_sku_lookup_v2;

-- Expected: 1743 rows inserted (live count verified read-only 2026-07-19).


-- ============================================================================
-- PART 3 — MARK DISCONTINUED
-- The retired TOOLS 645xxxx brush/roller series (CLAUDE_PLACE_ORDER.md §14,
-- SAP re-coded the range to 647xxxx on 2026-07-15).
--
-- These were switched off using isPrimary=false ONLY because mo_sku_lookup_v2
-- has no lifecycle flag. They are DISCONTINUED, not duplicate twins. This is
-- the one place the two concepts were conflated in live v2 data; splitting them
-- here is the whole point of adding "isActive".
--
-- DECISION (locked): set "isActive" = false, and leave "isPrimary" AS-IS for
-- now. Do not silently rewrite isPrimary in the same pass — the old codes stay
-- excluded from the order surfaces exactly as they are today, and untangling
-- isPrimary is a separate, reversible follow-up once the new table is proven.
--
-- Filter verified read-only against production 2026-07-19: returns EXACTLY 25
-- rows. Guard checks run at the same time:
--   - all TOOLS isPrimary=false rows (any prefix)  = 25  (same set, no strays)
--   - all 645% rows in ANY category                = 25  (all TOOLS, all
--                                                          isPrimary=false —
--                                                          no live 645% row is
--                                                          still primary)
--   - 645% TOOLS rows mentioning STICKER           = 0   (§14 says stickers
--                                                          were untouched; they
--                                                          are not 645-prefixed
--                                                          at all, so this
--                                                          filter cannot reach
--                                                          them)
-- All three predicates are kept below even though any one of them would select
-- the same 25 rows today — explicit beats clever on a data-retiring UPDATE.
-- ============================================================================

UPDATE "sku_master_v2"
SET "isActive"  = false,
    "updatedAt" = now()
WHERE category    = 'TOOLS'
  AND "isPrimary" = false
  AND material LIKE '645%';

-- Expected: 25 rows updated.


-- ============================================================================
-- PART 4 — VERIFY (SELECTs only — safe to re-run any time)
-- ============================================================================

-- 4a. Row counts must match exactly (source vs new table).
SELECT
  (SELECT COUNT(*) FROM mo_sku_lookup_v2) AS v2_rows,
  (SELECT COUNT(*) FROM "sku_master_v2")  AS new_rows,
  (SELECT COUNT(*) FROM mo_sku_lookup_v2)
    - (SELECT COUNT(*) FROM "sku_master_v2") AS difference_must_be_zero;

-- 4b. Discontinued count must equal the Step 1 verified count (25).
SELECT COUNT(*) AS discontinued_must_be_25
FROM "sku_master_v2"
WHERE "isActive" = false;

-- 4c. isPrimary sanity — must match v2 exactly (Part 3 does not touch it).
SELECT
  (SELECT COUNT(*) FROM mo_sku_lookup_v2 WHERE "isPrimary" = true)  AS v2_primary,
  (SELECT COUNT(*) FROM "sku_master_v2"  WHERE "isPrimary" = true)  AS new_primary,
  (SELECT COUNT(*) FROM mo_sku_lookup_v2 WHERE "isPrimary" = false) AS v2_non_primary,
  (SELECT COUNT(*) FROM "sku_master_v2"  WHERE "isPrimary" = false) AS new_non_primary;
-- Expected (verified 2026-07-19): 1391 primary / 352 non-primary on both sides.

-- 4d. The 25 discontinued rows, listed for eyeballing against the Step 1 list.
SELECT material, "packCode", unit, description, "isPrimary", "isActive"
FROM "sku_master_v2"
WHERE "isActive" = false
ORDER BY material;

-- 4e. 10-row sample of poured data — confirms columns landed in the right slots.
SELECT id, material, category, product, "baseColour", "packCode", unit,
       "isPrimary", "isActive", "createdAt", "updatedAt"
FROM "sku_master_v2"
ORDER BY id
LIMIT 10;

-- 4f. Belt-and-braces: no NOT NULL column silently landed empty-string, and no
--     material was mangled in transit. Both counts should be 0.
SELECT
  (SELECT COUNT(*) FROM "sku_master_v2"
     WHERE material = '' OR description = '' OR category = '' OR product = '')
    AS blank_required_fields_must_be_0,
  (SELECT COUNT(*) FROM mo_sku_lookup_v2 v2
     WHERE NOT EXISTS (
       SELECT 1 FROM "sku_master_v2" n WHERE n.material = v2.material
     ))
    AS v2_materials_missing_from_new_must_be_0;


-- ============================================================================
-- AFTER THIS SCRIPT — next session, not now:
--   1. Hand-edit prisma/schema.prisma to add `model sku_master_v2` matching
--      these exact column names (no @map needed).
--   2. `npx prisma generate`  (never db push / db pull — CORE §3).
--   3. Repoint readers. Per the 2026-07-19 discovery, the live repoint list is
--      small: picking detail route, import enrichment (6 call sites), the
--      removed-lines API, and the admin dashboard isActive count tile.
--      Tint / Challan / Sampling / Support board / Warehouse / Trip read the
--      old sku_master ZERO times — do not touch them.
-- ============================================================================
