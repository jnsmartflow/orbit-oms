-- ============================================================================
-- 2026-09-21 · Floor · TRIPS — the vehicle size (GC / Ace / Big)
--
-- The planner picks the size on the Upcountry trip form (New and Edit, required
-- there); Make trip on a load plan card sends the card's own size. The admin
-- "Load plan check" counts actual trucks by it. NULL = not given (older trips,
-- other delivery types) → the check says "unknown".
--
--   "vehicleSize"  text NULL, one of 'gc' | 'ace' | 'big'
--
-- 🔴 RUN THIS BEFORE THE DEPLOY THAT READS IT. The app selects trips."vehicleSize"
-- on every trip read (lib/trips/queries.ts); without the column those reads
-- fail (P2022) and the floor's trip rail breaks.
--
-- ONE SCRIPT, ALL OR NOTHING. 🔴 NO BEGIN/COMMIT — THE DO BLOCK IS THE
-- TRANSACTION (Supabase SQL Editor house rule): the column and its CHECK are
-- added together or not at all. Existing rows are untouched (NULL).
-- ⚠ A SECOND RUN FAILS (the column exists) and changes nothing.
-- ============================================================================

DO $$
BEGIN
  ALTER TABLE trips ADD COLUMN "vehicleSize" text NULL;
  ALTER TABLE trips ADD CONSTRAINT chk_trips_vehicle_size
    CHECK ("vehicleSize" IS NULL OR "vehicleSize" IN ('gc', 'ace', 'big'));
END $$;

-- ── CHECK (read-only) — expect one row: vehicleSize · text · YES, and every
--    existing trip counted under NULL ─────────────────────────────────────────
SELECT c.column_name, c.data_type, c.is_nullable,
       (SELECT count(*) FROM trips WHERE "vehicleSize" IS NULL) AS trips_without_size,
       (SELECT count(*) FROM trips) AS trips_total
FROM information_schema.columns c
WHERE c.table_name = 'trips' AND c.column_name = 'vehicleSize';
