-- ============================================================================
-- 2026-10-03 · Floor trips · TRIP RE-DELIVERY — table, activity vocabulary,
--              live-feed triggers
--
-- A bill that already went out on a truck and came back undelivered is put on
-- another Floor trip as a re-delivery (attempt 2, 3 …). One row per (trip, bill).
-- orders is NOT touched by this feature: no stage, hold or tripDropId change.
--
-- Plan of record: docs/prompts/drafts/web-update-2026-10-03-trip-redelivery.md
--                 (rev 5, §3 — the spec this file follows)
-- Discovery:      docs/prompts/drafts/code-discovery-2026-10-03-trip-redelivery.md
--
-- ── HOW TO RUN ──────────────────────────────────────────────────────────────
--   Supabase SQL Editor, AS ONE PASTE. No BEGIN/COMMIT (CORE §3).
--   🔴 RUN BEFORE ANY CODE THAT WRITES trip_redeliveries DEPLOYS. The code's
--   activity writer (lib/trips/activity.ts writeActivity) SWALLOWS a CHECK
--   refusal, so code deployed first would silently lose every
--   'redelivery_added' / 'redelivery_removed' history row.
--   The editor shows only the LAST result: the read-back at the foot (STEP 4).
--
--   NOT RE-RUNNABLE AS-IS: STEP 1's CREATE TABLE (no IF NOT EXISTS, on purpose)
--   fails on a second run. Read the live state first if in doubt.
--
-- ── WHAT DIFFERS FROM THE PLAN'S WORDING, AND WHY ───────────────────────────
--   Timestamps are timestamptz(6), not bare timestamptz: trips and trip_drops
--   were created with timestamptz(6) (docs/prompts/archive/2026-09/
--   web-update-2026-09-09-trip-schema.md §D1/§D2), and Prisma models them as
--   @db.Timestamptz(6). Same column type either way; (6) is written out to
--   match the sibling tables. id is serial / integer like trips and trip_drops.
--
--   Grants / RLS: none. The trips / trip_drops DDL issued no GRANT, REVOKE or
--   ENABLE ROW LEVEL SECURITY, so neither does this file.
-- ============================================================================


-- ============================================================================
-- STEP 1 — the table
--
-- tripId and tripDropId are BOTH stored and the code always writes them from
-- the same trip_drops row. Nothing in the database ties them together — a
-- landmine to record in canon (same shape as orders.shipToOverride /
-- shipToOverrideCustomerId).
--
-- Rows are DELETED on remove (plan rev 5) — no status column in v1, so the
-- unique on (tripId, orderId) is a full unique, not a partial index.
-- ============================================================================

CREATE TABLE trip_redeliveries (
  id                 serial         PRIMARY KEY,
  "tripId"           integer        NOT NULL,
  "tripDropId"       integer        NOT NULL,
  "orderId"          integer        NOT NULL,
  "obdNumber"        text           NOT NULL,   -- snapshot at add time
  "invoiceNo"        text           NULL,       -- snapshot; screens read live orders."invoiceNo"
  "attemptNo"        integer        NOT NULL,
  "prevTripId"       integer        NULL,       -- Orbit trip of the previous attempt
  reason             text           NOT NULL,
  note               text           NULL,
  "confirmedReturn"  boolean        NOT NULL DEFAULT false,  -- the same-day "Truck came back" tick
  "createdAt"        timestamptz(6) NOT NULL DEFAULT now(),
  "createdById"      integer        NOT NULL,
  "updatedAt"        timestamptz(6) NOT NULL DEFAULT now()   -- @updatedAt in Prisma; no trigger
);

-- 🔴 RESTRICT on the stop: a trip_drops row deleted under a re-delivery must
-- FAIL LOUDLY. app/api/floor/trips/[id]/bills/route.ts deletes a stop when it
-- holds no orders — that count must learn about re-deliveries in the code step.
ALTER TABLE trip_redeliveries ADD CONSTRAINT trip_redeliveries_trip_fkey
  FOREIGN KEY ("tripId") REFERENCES trips(id) ON DELETE RESTRICT;
ALTER TABLE trip_redeliveries ADD CONSTRAINT trip_redeliveries_drop_fkey
  FOREIGN KEY ("tripDropId") REFERENCES trip_drops(id) ON DELETE RESTRICT;
ALTER TABLE trip_redeliveries ADD CONSTRAINT trip_redeliveries_order_fkey
  FOREIGN KEY ("orderId") REFERENCES orders(id) ON DELETE RESTRICT;
-- Default rule (NO ACTION), like the plain FKs on trips.
ALTER TABLE trip_redeliveries ADD CONSTRAINT trip_redeliveries_prev_trip_fkey
  FOREIGN KEY ("prevTripId") REFERENCES trips(id);
-- Default rule, like trips."createdById" (trips_createdById_fkey).
ALTER TABLE trip_redeliveries ADD CONSTRAINT trip_redeliveries_created_by_fkey
  FOREIGN KEY ("createdById") REFERENCES users(id);

-- Value fences — invisible to Prisma; record them in the schema.prisma header.
ALTER TABLE trip_redeliveries ADD CONSTRAINT chk_trip_redeliveries_attempt
  CHECK ("attemptNo" >= 2);
-- A new reason = ALTER this CHECK first, then the vocabulary constant in code.
ALTER TABLE trip_redeliveries ADD CONSTRAINT chk_trip_redeliveries_reason
  CHECK (reason IN ('site_closed', 'wrong_dispatch'));

-- One bill once per trip. Also the find for "already on this trip".
ALTER TABLE trip_redeliveries ADD CONSTRAINT trip_redeliveries_trip_order_key
  UNIQUE ("tripId", "orderId");

-- tripId is the leading column of the unique above, so it needs no index of its own.
CREATE INDEX trip_redeliveries_drop_idx  ON trip_redeliveries ("tripDropId");
CREATE INDEX trip_redeliveries_order_idx ON trip_redeliveries ("orderId");

COMMENT ON TABLE trip_redeliveries IS
  'A bill put on a later Floor trip after an earlier truck came back undelivered (attempt >= 2). One row per (trip, bill); deleted on remove. Never writes orders: the bill keeps its own tripDropId, stage and hold. tripId and tripDropId are written from the same trip_drops row; nothing in the database ties them.';


-- ============================================================================
-- STEP 2 — two actions join the trip activity vocabulary (14 → 16)
--
-- 'redelivery_added', 'redelivery_removed'. TypeScript twins go in
-- TRIP_ACTIONS (lib/trips/activity.ts). Same fence-never-down pattern as
-- sql/2026-09-15-slice9-print-tab.sql STEP 2: add under a temporary name, drop
-- the old, rename. The table is never without a fence.
-- ============================================================================

ALTER TABLE trip_activity ADD CONSTRAINT chk_trip_activity_action_v2 CHECK (
  action IN ('created', 'bills_added', 'bills_removed', 'vehicle_changed',
             'details_changed', 'cancelled', 'released', 'dispatched', 'renamed',
             'shown', 'taken_back',
             'sent_to_billing', 'taken_back_from_billing', 'invoices_copied',
             'redelivery_added', 'redelivery_removed')
);

ALTER TABLE trip_activity DROP CONSTRAINT chk_trip_activity_action;

ALTER TABLE trip_activity RENAME CONSTRAINT chk_trip_activity_action_v2 TO chk_trip_activity_action;


-- ============================================================================
-- STEP 3 — live-feed triggers (Floor's change feed, entity 'trip')
--
-- Copied from the trip_drops triggers in sql/2026-09-30-live-changes-step4.sql
-- (lines 468-477): the SAME generic functions live_changes_child_{ins,upd,del}(),
-- AFTER, FOR EACH STATEMENT, transition tables lc_new / lc_old, arguments
-- ('trip', 'parent', 'tripId') — this table names its parent trip in "tripId"
-- exactly as trip_drops does, so a re-delivery add / remove refreshes that trip
-- on every open desk. No new function.
--
-- The functions swallow their own failure (RAISE WARNING) — a broken feed never
-- fails the write. Kill switch:
--   ALTER TABLE trip_redeliveries DISABLE TRIGGER trg_live_changes_trip_redeliveries_ins;
--   ALTER TABLE trip_redeliveries DISABLE TRIGGER trg_live_changes_trip_redeliveries_upd;
--   ALTER TABLE trip_redeliveries DISABLE TRIGGER trg_live_changes_trip_redeliveries_del;
-- ============================================================================

DROP TRIGGER IF EXISTS trg_live_changes_trip_redeliveries_ins ON trip_redeliveries;
CREATE TRIGGER trg_live_changes_trip_redeliveries_ins AFTER INSERT ON trip_redeliveries REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_ins('trip', 'parent', 'tripId');
DROP TRIGGER IF EXISTS trg_live_changes_trip_redeliveries_upd ON trip_redeliveries;
CREATE TRIGGER trg_live_changes_trip_redeliveries_upd AFTER UPDATE ON trip_redeliveries REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_upd('trip', 'parent', 'tripId');
DROP TRIGGER IF EXISTS trg_live_changes_trip_redeliveries_del ON trip_redeliveries;
CREATE TRIGGER trg_live_changes_trip_redeliveries_del AFTER DELETE ON trip_redeliveries REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_del('trip', 'parent', 'tripId');


-- ============================================================================
-- STEP 4 — READ-BACK (read-only). ONE result: sec / k / v, all text.
-- Expect:
--   1 constraint : 9 rows — pkey, 5 FKs (3 RESTRICT, 2 default), 2 CHECKs, 1 UNIQUE
--   2 index      : 4 rows — pkey, the unique's index, drop_idx, order_idx
--   3 activity   : 1 row  — 16 values ending 'redelivery_added', 'redelivery_removed'
--   4 trigger    : 3 rows — AFTER INSERT / UPDATE / DELETE, STATEMENT
--   5 column     : 14 rows
-- ============================================================================

SELECT sec, k, v FROM (
  SELECT '1 constraint'::text AS sec, c.conname::text AS k, pg_get_constraintdef(c.oid)::text AS v
    FROM pg_constraint c
   WHERE c.conrelid = 'trip_redeliveries'::regclass
  UNION ALL
  SELECT '2 index'::text, i.indexname::text, i.indexdef::text
    FROM pg_indexes i
   WHERE i.schemaname = 'public' AND i.tablename = 'trip_redeliveries'
  UNION ALL
  SELECT '3 activity'::text, c.conname::text, pg_get_constraintdef(c.oid)::text
    FROM pg_constraint c
   WHERE c.conrelid = 'trip_activity'::regclass AND c.conname::text LIKE 'chk_trip_activity_action%'
  UNION ALL
  SELECT '4 trigger'::text,
         t.trigger_name::text,
         (t.action_timing::text || ' ' || t.event_manipulation::text || ' · ' ||
          t.action_orientation::text || ' · ' || t.action_statement::text)::text
    FROM information_schema.triggers t
   WHERE t.event_object_table = 'trip_redeliveries'
  UNION ALL
  SELECT '5 column'::text,
         (lpad(col.ordinal_position::text, 2, '0') || ' ' || col.column_name::text)::text,
         (col.data_type::text || ' · null=' || col.is_nullable::text ||
          ' · default=' || coalesce(col.column_default::text, '—'))::text
    FROM information_schema.columns col
   WHERE col.table_schema = 'public' AND col.table_name = 'trip_redeliveries'
) x
ORDER BY sec, k;
