-- ============================================================================
-- 2026-09-15 · Floor trip desk · SLICE 6 — settle today's drafts that already have a vehicle
--
-- Since slice 6 a vehicle is what moves a trip out of draft, on the server: a
-- trip created with one is born `released`, and a PATCH that sets one on a draft
-- writes `released` and the stamps. Nothing re-settles a trip that ALREADY had
-- its vehicle before the change. Five such drafts existed on 2026-09-15.
--
-- 🔴 REVISED BEFORE IT WAS RUN — THREE, NOT FIVE (owner, 2026-09-15). Two of the
-- five are EXCLUDED BY NAME and stay drafts:
--
--     L-260912-08   Sat 12 Sep   5 bills, all checked, 0 dispatched
--     U-260914-03   Mon 14 Sep  10 bills, all checked, 0 dispatched
--
-- They are on today's desk only because the carry-forward rule
-- (lib/trips/live-trips.ts) follows a DRAFT onto later days. Settling them would
-- drop 15 checked, never-dispatched bills off the desk before anyone knows
-- whether the goods left the building. Left as drafts they stay exactly where
-- they are. Decide them by hand: Mark dispatched if the goods went, otherwise
-- leave them. ⚠ Editing either one's VEHICLE through the floor screen would
-- settle it (PATCH route) — change their note or slot freely, not the vehicle.
--
-- One history row per settled trip, action 'released', actor user 1, and the
-- summary says plainly that it was the migration and not a person. The summary
-- avoids the words Draft and Confirmed — the history panel renders it, and both
-- words are off the screen since slice 6. The fact rides in `detail.confirmed`.
--
-- ── RUN ORDER ────────────────────────────────────────────────────────────────
--   AFTER the slice 6 deploy is live and the owner has looked at /floor.
--   Idempotent: a second run finds nothing.
--
-- No schema change. No BEGIN/COMMIT (Supabase SQL Editor). Each part is its own
-- run; the editor shows only the last statement's result.
-- ============================================================================


-- ── A · PREVIEW (read-only). Expect 3 rows today: L-260915-01, -03, -04. ────
SELECT t.id, t."tripNumber", t."tripDate"::text AS trip_date,
       coalesce(v."vehicleNo", t."adhocVehicleNo") AS vehicle,
       t."releasedAt"
FROM trips t
LEFT JOIN vehicle_master v ON v.id = t."vehicleId"
WHERE t.status = 'draft'
  AND (t."vehicleId" IS NOT NULL OR t."adhocVehicleNo" IS NOT NULL)
  AND t."tripNumber" NOT IN ('L-260912-08', 'U-260914-03')
ORDER BY t."createdAt";


-- ── B · THE WRITE. One statement: the trips and their history rows commit together.
-- `releasedAt` / `releasedById` are written only where they are still empty,
-- the rule POST …/confirm and the PATCH route both keep. The two excluded trips
-- are named here AND in A, so the preview and the write cannot disagree.
WITH settled AS (
  UPDATE trips
     SET status         = 'released',
         "releasedById" = CASE WHEN "releasedAt" IS NULL THEN 1 ELSE "releasedById" END,
         "releasedAt"   = coalesce("releasedAt", now()),
         "updatedAt"    = now()
   WHERE status = 'draft'
     AND ("vehicleId" IS NOT NULL OR "adhocVehicleNo" IS NOT NULL)
     AND "tripNumber" NOT IN ('L-260912-08', 'U-260914-03')
  RETURNING id, "tripNumber", "vehicleId", "adhocVehicleNo"
)
INSERT INTO trip_activity ("tripId", action, "actorId", summary, detail)
SELECT
  s.id,
  'released',
  1,
  'Vehicle ' || coalesce(v."vehicleNo", s."adhocVehicleNo")
    || ' was already set, so the one-off slice 6 migration settled this trip — not a person''s action',
  jsonb_build_object(
    'confirmed', true,
    'vehicle',   coalesce(v."vehicleNo", s."adhocVehicleNo"),
    'source',    'sql/2026-09-15-slice6-settle-drafts.sql'
  )
FROM settled s
LEFT JOIN vehicle_master v ON v.id = s."vehicleId";


-- ── C · CHECK. Expect drafts_with_vehicle = 2, still_drafts = both excluded
--        names, and migration_rows = 3. ────────────────────────────────────────
SELECT
  (SELECT count(*)::int FROM trips
    WHERE status = 'draft' AND ("vehicleId" IS NOT NULL OR "adhocVehicleNo" IS NOT NULL)) AS drafts_with_vehicle,
  (SELECT string_agg("tripNumber", ', ' ORDER BY "tripNumber") FROM trips
    WHERE status = 'draft' AND ("vehicleId" IS NOT NULL OR "adhocVehicleNo" IS NOT NULL)) AS still_drafts,
  (SELECT count(*)::int FROM trip_activity
    WHERE action = 'released' AND detail->>'source' = 'sql/2026-09-15-slice6-settle-drafts.sql') AS migration_rows;
