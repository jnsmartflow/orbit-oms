-- ── Phase 1 schema changes ───────────────────────────────────────────────────
-- Run this once in Supabase SQL Editor.
-- Safe to run multiple times (uses IF NOT EXISTS / IF EXISTS guards).

-- ── 1. route_master: add optional description ────────────────────────────────
ALTER TABLE route_master ADD COLUMN IF NOT EXISTS description TEXT;

-- ── 2. vehicle_master: expand from stub ──────────────────────────────────────
ALTER TABLE vehicle_master ADD COLUMN IF NOT EXISTS "vehicleNumber" TEXT;
ALTER TABLE vehicle_master ADD COLUMN IF NOT EXISTS "vehicleType" TEXT;
ALTER TABLE vehicle_master ADD COLUMN IF NOT EXISTS "capacityKg" FLOAT8;
ALTER TABLE vehicle_master ADD COLUMN IF NOT EXISTS "capacityCbm" FLOAT8;
ALTER TABLE vehicle_master ADD COLUMN IF NOT EXISTS "deliveryTypeId" INTEGER REFERENCES delivery_type_master(id);
ALTER TABLE vehicle_master ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE vehicle_master ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Delete any stub rows without a vehicle number (no real data in stub)
DELETE FROM vehicle_master WHERE "vehicleNumber" IS NULL;

-- Add NOT NULL constraints now that stub rows are removed
ALTER TABLE vehicle_master ALTER COLUMN "vehicleNumber" SET NOT NULL;
ALTER TABLE vehicle_master ALTER COLUMN "vehicleType" SET NOT NULL;
ALTER TABLE vehicle_master ALTER COLUMN "capacityKg" SET NOT NULL;
ALTER TABLE vehicle_master ALTER COLUMN "deliveryTypeId" SET NOT NULL;

-- Add unique constraint on vehicleNumber (idempotent guard)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_master_vehicleNumber_key'
  ) THEN
    ALTER TABLE vehicle_master ADD CONSTRAINT "vehicle_master_vehicleNumber_key" UNIQUE ("vehicleNumber");
  END IF;
END $$;

-- ── 3. sales_officer_master: add employeeCode + phone, make email optional ───
ALTER TABLE sales_officer_master ADD COLUMN IF NOT EXISTS "employeeCode" TEXT;
ALTER TABLE sales_officer_master ADD COLUMN IF NOT EXISTS phone TEXT;
-- Make email nullable (PostgreSQL allows multiple NULLs in a unique index)
ALTER TABLE sales_officer_master ALTER COLUMN email DROP NOT NULL;

-- ── 4. delivery_point_master: add salesOfficerId + acceptsPartialDelivery ────
ALTER TABLE delivery_point_master
  ADD COLUMN IF NOT EXISTS "salesOfficerId" INTEGER REFERENCES sales_officer_master(id);
ALTER TABLE delivery_point_master
  ADD COLUMN IF NOT EXISTS "acceptsPartialDelivery" BOOLEAN NOT NULL DEFAULT TRUE;

-- Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name IN ('route_master','vehicle_master','sales_officer_master','delivery_point_master')
ORDER BY table_name, ordinal_position;
