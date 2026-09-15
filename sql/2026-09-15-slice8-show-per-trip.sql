-- ============================================================================
-- 2026-09-15 · Floor trip desk · SLICE 8 — Show to floor becomes per trip
--
-- With desk control on, a WAITING bill reaches the supervisor's Assign tab when
-- it is on no trip, or on a trip the desk has SHOWN. The decision moves from the
-- bill (orders.pickVisibleAt, stamped by the retired per-bill Show strip) to the
-- trip (trips.shownAt). Turning desk control on first marks shown every trip
-- already holding a waiting bill, so nothing leaves the supervisor's screen.
--
-- Code: lib/picking/visibility-gate.ts, lib/trips/show.ts, lib/picking/queue.ts,
--       app/api/floor/trips/[id]/show/route.ts, app/api/floor/pick-gate/route.ts
--
-- ── RUN ORDER — EACH STEP IS ITS OWN RUN IN THE SQL EDITOR ──────────────────
--   BEFORE the deploy:  STEP 1 → STEP 2
--   THE DEPLOY:         git push (Vercel builds from origin/main)
--   AFTER the deploy:   STEP 3
--
-- 🔴 WHY 1 AND 2 MUST RUN FIRST. The new code SELECTs trips."shownAt" on every
-- trip read and on the supervisor's board; deployed without the column, those
-- queries fail. And the first Show press writes a trip_activity row with action
-- 'shown', which the CHECK must already admit.
--
-- 🔴 WHY 3 RUNS AFTER. Until the deploy, the OLD per-bill Show strip is still live
-- and could stamp a bill if someone turned desk control on. After the deploy
-- nothing writes the column, so the clear is final.
--
-- No BEGIN/COMMIT (Supabase SQL Editor). Each step ends with its own check.
-- ============================================================================


-- ============================================================================
-- STEP 1 — BEFORE DEPLOY · trips.shownAt / shownById
--
-- Null = not shown. The FIFTH FK from trips to users; ON DELETE SET NULL exactly
-- like releasedById / dispatchedById / cancelledById. No index: every reader
-- reaches trips by id or by tripDropId → trip, and trips holds ~120 rows.
-- ============================================================================

ALTER TABLE trips
  ADD COLUMN "shownAt"   timestamptz(6),
  ADD COLUMN "shownById" integer;

ALTER TABLE trips
  ADD CONSTRAINT "trips_shownById_fkey"
  FOREIGN KEY ("shownById") REFERENCES users(id) ON DELETE SET NULL;

-- Check: expect two rows (shownAt timestamp with time zone, shownById integer,
-- both nullable) and the FK.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'trips' AND column_name IN ('shownAt', 'shownById')
UNION ALL
SELECT conname, pg_get_constraintdef(oid), 'fk'
FROM pg_constraint
WHERE conrelid = 'trips'::regclass AND conname = 'trips_shownById_fkey';


-- ============================================================================
-- STEP 2 — BEFORE DEPLOY · 'shown' and 'taken_back' join the activity vocabulary
--
-- TypeScript twins: TRIP_SHOWN / TRIP_TAKEN_BACK in lib/trips/activity.ts.
-- Added under a temporary name, the old dropped, then renamed — never unfenced.
-- ============================================================================

ALTER TABLE trip_activity ADD CONSTRAINT chk_trip_activity_action_v2 CHECK (
  action IN ('created', 'bills_added', 'bills_removed', 'vehicle_changed',
             'details_changed', 'cancelled', 'released', 'dispatched', 'renamed',
             'shown', 'taken_back')
);

ALTER TABLE trip_activity DROP CONSTRAINT chk_trip_activity_action;

ALTER TABLE trip_activity RENAME CONSTRAINT chk_trip_activity_action_v2 TO chk_trip_activity_action;

-- Check: expect ONE row ending in 'shown', 'taken_back'.
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'trip_activity'::regclass AND conname LIKE 'chk_trip_activity_action%';


-- ============================================================================
-- STEP 3 — AFTER DEPLOY · clear the 51 stale per-bill stamps
--
-- Read 2026-09-15: 51 orders carry pickVisibleAt, every one stale — 40 on
-- dispatched bills, 7 cancelled, 4 checked, NONE on a waiting bill. Nothing reads
-- the column after the deploy; the columns themselves stay for a later drop.
--
-- ⚠ A raw UPDATE does not touch orders."updatedAt" (that is @updatedAt, set by
-- Prisma, not by the database), so no board's live-sync marker sees a change.
-- ============================================================================

-- 3a · PREVIEW (read-only). Expect today: stamped 51, on_waiting_bills 0.
SELECT
  count(*)::int AS stamped,
  count(*) FILTER (WHERE "workflowStage" = 'pending_picking')::int AS on_waiting_bills
FROM orders
WHERE "pickVisibleAt" IS NOT NULL OR "pickVisibleById" IS NOT NULL;

-- 3b · THE CLEAR.
UPDATE orders
   SET "pickVisibleAt" = NULL,
       "pickVisibleById" = NULL
 WHERE "pickVisibleAt" IS NOT NULL OR "pickVisibleById" IS NOT NULL;

-- 3c · CHECK. Expect still_stamped = 0.
SELECT count(*)::int AS still_stamped
FROM orders
WHERE "pickVisibleAt" IS NOT NULL OR "pickVisibleById" IS NOT NULL;
