BEGIN;

ALTER TABLE delivery_challan_formulas
  ADD COLUMN IF NOT EXISTS "isManuallyOverridden" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE delivery_challan_formulas
  ADD COLUMN IF NOT EXISTS "autoFilledAt" TIMESTAMPTZ NULL;

ALTER TABLE delivery_challan_formulas
  ADD COLUMN IF NOT EXISTS "sourceTiEntryId" INTEGER NULL;

COMMIT;

-- Notes:
-- - sourceTiEntryId points to tinter_issue_entries.id OR
--   tinter_issue_entries_b.id depending on which table the
--   auto-fill came from. No FK constraint (cross-table pointer).
-- - All existing rows will get isManuallyOverridden=false by default.
--   This is WRONG for them (they were manually typed). Phase 4
--   will fix this — DO NOT touch existing rows in this SQL.
