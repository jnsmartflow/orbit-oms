-- Migration: Schema v14 — Delivery Challan
-- Apply via Supabase SQL Editor. Do NOT run via prisma db push locally.
-- Generated: March 2026

-- ============================================================
-- 1. delivery_challans
-- ============================================================
CREATE TABLE IF NOT EXISTS delivery_challans (
  id              SERIAL PRIMARY KEY,
  "orderId"       INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  "challanNumber" TEXT    NOT NULL UNIQUE,
  transporter     TEXT,
  "vehicleNo"     TEXT,
  "printedAt"     TIMESTAMPTZ,
  "printedBy"     INTEGER REFERENCES users(id),
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. delivery_challan_formulas
-- ============================================================
CREATE TABLE IF NOT EXISTS delivery_challan_formulas (
  id              SERIAL PRIMARY KEY,
  "challanId"     INTEGER NOT NULL REFERENCES delivery_challans(id),
  "rawLineItemId" INTEGER NOT NULL REFERENCES import_raw_line_items(id),
  formula         TEXT    NOT NULL,
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("challanId", "rawLineItemId")
);

-- ============================================================
-- 3. import_raw_summary — add smuNumber column
-- ============================================================
ALTER TABLE import_raw_summary
  ADD COLUMN IF NOT EXISTS "smuNumber" TEXT;
