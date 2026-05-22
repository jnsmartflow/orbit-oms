-- Sampling Library — Phase 1 schema
-- Spec: docs/prompts/drafts/SAMPLING_LIBRARY_DESIGN_SPEC.md
-- Date: 2026-05-21
-- Run in: Supabase SQL Editor (never prisma db push)
--
-- Enum dependency: "TinterType" and "PackCode" already exist in Postgres
-- (Prisma-managed, see prisma/schema.prisma). No CREATE TYPE needed.

-- ── 1. sampling_register (parent — one row per sampling number) ───────────────
-- samplingNo is a natural key: preserve legacy Excel values, application
-- computes MAX+1 for new rows. No autoincrement.

CREATE TABLE IF NOT EXISTS sampling_register (
  "samplingNo"     INTEGER       PRIMARY KEY,
  "shadeName"      TEXT          NOT NULL,
  "tinterType"     "TinterType"  NOT NULL,
  "siteId"         INTEGER       REFERENCES delivery_point_master(id) ON DELETE RESTRICT,
  "salesOfficerId" INTEGER       REFERENCES sales_officer_master(id) ON DELETE RESTRICT,
  "dealerName"     TEXT,
  "notes"          TEXT,
  "isActive"       BOOLEAN       NOT NULL DEFAULT TRUE,
  "needsReview"    BOOLEAN       NOT NULL DEFAULT FALSE,
  "createdById"    INTEGER       NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "createdAt"      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Indexes — list-pane filters: Type, Status, SO, Site, Needs Review, shade search
CREATE INDEX IF NOT EXISTS idx_sampling_register_type_active
  ON sampling_register ("tinterType", "isActive");
CREATE INDEX IF NOT EXISTS idx_sampling_register_needs_review
  ON sampling_register ("needsReview");
CREATE INDEX IF NOT EXISTS idx_sampling_register_site
  ON sampling_register ("siteId");
CREATE INDEX IF NOT EXISTS idx_sampling_register_sales_officer
  ON sampling_register ("salesOfficerId");
CREATE INDEX IF NOT EXISTS idx_sampling_register_shade_name
  ON sampling_register ("shadeName");

-- ── 2. sampling_recipes (child — one row per SKU + pack recipe variant) ───────

CREATE TABLE IF NOT EXISTS sampling_recipes (
  "id"           SERIAL        PRIMARY KEY,
  "samplingNo"   INTEGER       NOT NULL REFERENCES sampling_register("samplingNo") ON DELETE RESTRICT,
  "skuCode"      TEXT          NOT NULL,
  "productName"  TEXT,
  "packCode"     "PackCode"    NOT NULL,
  "tinQty"       DECIMAL(10,3) NOT NULL DEFAULT 0,
  -- 13 TINTER pigment columns
  "YOX"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "LFY"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "GRN"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "TBL"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "WHT"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "MAG"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "FFR"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "BLK"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "OXR"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "HEY"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "HER"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "COB"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "COG"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  -- 14 ACOTONE pigment columns
  "YE2"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "YE1"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "XY1"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "XR1"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "WH1"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "RE2"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "RE1"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "OR1"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "NO2"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "NO1"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "MA1"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "GR1"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "BU2"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "BU1"          DECIMAL(10,3) NOT NULL DEFAULT 0,
  "isPrimary"    BOOLEAN       NOT NULL DEFAULT FALSE,
  "usageCount"   INTEGER       NOT NULL DEFAULT 0,
  "firstUsedAt"  TIMESTAMPTZ,
  "lastUsedAt"   TIMESTAMPTZ,
  "createdAt"    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT sampling_recipes_sampling_sku_pack_key
    UNIQUE ("samplingNo", "skuCode", "packCode")
);

-- Indexes — child hot path: SKU+pack lookup, last-used sort, primary variant
CREATE INDEX IF NOT EXISTS idx_sampling_recipes_sampling_no
  ON sampling_recipes ("samplingNo");
CREATE INDEX IF NOT EXISTS idx_sampling_recipes_sku_pack
  ON sampling_recipes ("skuCode", "packCode");
CREATE INDEX IF NOT EXISTS idx_sampling_recipes_last_used
  ON sampling_recipes ("lastUsedAt" DESC);
CREATE INDEX IF NOT EXISTS idx_sampling_recipes_primary
  ON sampling_recipes ("samplingNo", "isPrimary");

-- ── Verification (run manually after CREATE) ──────────────────────────────────
-- SELECT COUNT(*) FROM sampling_register;
-- SELECT COUNT(*) FROM sampling_recipes;
