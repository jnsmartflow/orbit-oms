-- ── Add dispatch_cutoff_master table ────────────────────────────────────────
-- Run this in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS dispatch_cutoff_master (
  id                SERIAL PRIMARY KEY,
  "deliveryTypeId"  INTEGER NOT NULL REFERENCES delivery_type_master(id),
  "slotNumber"      INTEGER NOT NULL,
  "cutoffTime"      TEXT NOT NULL DEFAULT '',
  label             TEXT NOT NULL,
  "isDefaultForType" BOOLEAN NOT NULL DEFAULT FALSE,
  "isActive"        BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "dispatch_cutoff_master_deliveryTypeId_slotNumber_key"
    UNIQUE ("deliveryTypeId", "slotNumber")
);

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'dispatch_cutoff_master'
ORDER BY ordinal_position;
