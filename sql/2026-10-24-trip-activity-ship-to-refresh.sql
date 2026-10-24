-- sql/2026-10-24-trip-activity-ship-to-refresh.sql
--
-- chk_trip_activity_action: 18 → 20 values.
--   + 'ship_to_changed'  a bill on a trip had its ship-to changed and moved stop
--   + 'stops_refreshed'  a trip's stops re-read from master (button or automatic)
--
-- Run as ONE block in the Supabase SQL Editor (Smart Flow). No BEGIN/COMMIT:
-- the editor sends the whole block as one query, which Postgres runs as one
-- implicit transaction — if any statement fails, everything before it is rolled
-- back too.
--
-- SAFE TO FAIL. The new list keeps all 18 current values, so no existing row
-- can break it. If some row did carry an action outside the list, the ADD below
-- would fail, the DROP above it would roll back with it, and the live CHECK
-- would stay exactly as it is now. Nothing is lost.
--
-- The 18 current values = TRIP_ACTIONS in lib/trips/activity.ts = the last
-- CHECK written by sql/2026-10-05-billing-print-v2.sql (CORE v27.56). App code
-- (TRIP_ACTIONS + the writers) gains the two new values in the NEXT step, after
-- this has run — not before.
--
-- The editor shows only the LAST statement's result, so step 1 is for the
-- History tab / a separate run; step 4 is the proof.

-- 1. BEFORE — the live constraint text, and every action in use today.
SELECT '1 constraint before'::text AS item, pg_get_constraintdef(c.oid)::text AS value
  FROM pg_constraint c
 WHERE c.conrelid = 'trip_activity'::regclass AND c.conname = 'chk_trip_activity_action'
UNION ALL
SELECT '2 action in use'::text, (a.action || ' · ' || count(*)::text)::text
  FROM trip_activity a
 GROUP BY a.action;

-- 2. Drop the old CHECK.
ALTER TABLE trip_activity DROP CONSTRAINT chk_trip_activity_action;

-- 3. The new CHECK: the 18 values of TRIP_ACTIONS, in its order, plus the two new ones.
ALTER TABLE trip_activity ADD CONSTRAINT chk_trip_activity_action CHECK (
  action IN ('created', 'bills_added', 'bills_removed', 'vehicle_changed',
             'details_changed', 'cancelled', 'renamed',
             'shown', 'taken_back',
             'sent_to_billing', 'taken_back_from_billing', 'invoices_copied',
             'released', 'dispatched',
             'redelivery_added', 'redelivery_removed',
             'bills_copied', 'billing_done',
             'ship_to_changed', 'stops_refreshed')
);

-- 4. AFTER — the proof. Expect one 'constraint after' row naming 20 values,
-- 'value count' = 20, and 'rows outside the list' = 0.
SELECT '1 constraint after'::text AS item, pg_get_constraintdef(c.oid)::text AS value
  FROM pg_constraint c
 WHERE c.conrelid = 'trip_activity'::regclass AND c.conname = 'chk_trip_activity_action'
UNION ALL
SELECT '2 value count'::text,
       (SELECT count(*) FROM regexp_matches(pg_get_constraintdef(c.oid), '''[a-z_]+''::text', 'g'))::text
  FROM pg_constraint c
 WHERE c.conrelid = 'trip_activity'::regclass AND c.conname = 'chk_trip_activity_action'
UNION ALL
SELECT '3 rows outside the list'::text, count(*)::text
  FROM trip_activity a
 WHERE a.action NOT IN ('created', 'bills_added', 'bills_removed', 'vehicle_changed',
                        'details_changed', 'cancelled', 'renamed', 'shown', 'taken_back',
                        'sent_to_billing', 'taken_back_from_billing', 'invoices_copied',
                        'released', 'dispatched', 'redelivery_added', 'redelivery_removed',
                        'bills_copied', 'billing_done', 'ship_to_changed', 'stops_refreshed');
