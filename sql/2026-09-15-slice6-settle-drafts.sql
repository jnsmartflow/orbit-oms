-- ============================================================================
-- 2026-09-15 · Floor trip desk · SLICE 6 — settle the drafts that already have a vehicle
--
-- Since slice 6 a vehicle is what moves a trip out of draft, on the server: a
-- trip created with one is born `released`, and a PATCH that sets one on a draft
-- writes `released` and the stamps. Nothing re-settles a trip that ALREADY had
-- its vehicle before the change — five drafts on 2026-09-15, every one with a
-- vehicle, two of them already carried forward off their own day
-- (L-260912-08, U-260914-03). This settles them.
--
-- One history row per trip, action 'released', actor user 1, and the summary
-- says plainly that it was the migration and not a person. The summary avoids
-- the words Draft and Confirmed — the history panel renders it, and both words
-- are off the screen since slice 6. The fact rides in `detail.confirmed`.
--
-- ── RUN ORDER ────────────────────────────────────────────────────────────────
--   AFTER the slice 6 deploy is live. Until then the OLD create route can still
--   make a draft with a vehicle; running after catches those too. It is
--   idempotent — a second run finds nothing — so running it early is harmless,
--   just possibly incomplete.
--
-- No schema change. No BEGIN/COMMIT (Supabase SQL Editor). Each part is its own
-- run; the editor shows only the last statement's result.
-- ============================================================================


-- ── A · PREVIEW (read-only). Expect 5 rows today, every one with a vehicle. ──
SELECT t.id, t."tripNumber", t."tripDate"::text AS trip_date,
       coalesce(v."vehicleNo", t."adhocVehicleNo") AS vehicle,
       t."releasedAt"
FROM trips t
LEFT JOIN vehicle_master v ON v.id = t."vehicleId"
WHERE t.status = 'draft'
  AND (t."vehicleId" IS NOT NULL OR t."adhocVehicleNo" IS NOT NULL)
ORDER BY t."createdAt";


-- ── B · THE WRITE. One statement: the trips and their history rows commit together.
-- `releasedAt` / `releasedById` are written only where they are still empty,
-- the rule POST …/confirm and the PATCH route both keep.
WITH settled AS (
  UPDATE trips
     SET status         = 'released',
         "releasedById" = CASE WHEN "releasedAt" IS NULL THEN 1 ELSE "releasedById" END,
         "releasedAt"   = coalesce("releasedAt", now()),
         "updatedAt"    = now()
   WHERE status = 'draft'
     AND ("vehicleId" IS NOT NULL OR "adhocVehicleNo" IS NOT NULL)
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


-- ── C · CHECK. Expect drafts_with_vehicle = 0 and migration_rows = 5. ────────
SELECT
  (SELECT count(*)::int FROM trips
    WHERE status = 'draft' AND ("vehicleId" IS NOT NULL OR "adhocVehicleNo" IS NOT NULL)) AS drafts_with_vehicle,
  (SELECT count(*)::int FROM trip_activity
    WHERE action = 'released' AND detail->>'source' = 'sql/2026-09-15-slice6-settle-drafts.sql') AS migration_rows;
