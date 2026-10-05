-- ============================================================================
-- 2026-10-05 · Billing Print v2 — per-bill copy, trip Done, activity vocabulary
--
-- Mints Schema v27.56. ⚠ Do NOT edit docs/CLAUDE_CORE.md in this step — the
-- chain entry, §7.16 row and §13 live-feed list are written in the Prisma prompt.
--
-- ✅ APPLIED TO LIVE 2026-10-05 by Smart Flow (PARTS B + C + D). Read-back: 9
-- columns, 7 constraints, 3 triggers, 18 activity values; backfill 39 rows
-- (kind=backfill), 6 trips Done via the match, 0 via the dispatched rule, 4 open.
-- ⚠ B2's FK was written UNQUOTED, so Postgres stored it LOWERCASE:
-- trips_billingdonebyid_fkey — which is why PART D's mixed-case lookup below
-- returned no row. The code and canon cite the stored (lowercase) name.
--
-- Plan of record: the Billing Print v2 plan (2026-10-05), §2–§4, plus the owner
-- decisions of 2026-10-05:
--   · Pick delete tab: NO CHANGE (D9–D12 dropped).
--   · A READY bill's panel "Copy this one" copies AND records → kind 'single'.
--   · Backfill: every sent, non-cancelled trip with status = 'dispatched' is
--     marked Done even if not every bill was copied. Done is a TRIP stamp only —
--     no trip_bill_copies rows are written for those uncopied bills.
--
-- ── HOW TO RUN ──────────────────────────────────────────────────────────────
--   Supabase SQL Editor. No BEGIN/COMMIT (CORE §3). The editor shows only the
--   LAST result of a paste.
--
--   1. Select PART A ALONE and run it. Read-only. Send its grid to the owner
--      before anything else runs.
--   2. Then run PART B + PART C + PART D together, as ONE paste.
--      🔴 BEFORE any code that writes 'bills_copied' / 'billing_done' deploys:
--      lib/trips/activity.ts writeActivity SWALLOWS a CHECK refusal, so code
--      deployed first would silently lose those history rows.
--   3. Run PART C again (alone, or C + D) RIGHT AFTER the Print server deploy.
--      It catches copies the OLD code recorded in between (invoices_copied).
--      Both of its Done updates skip any trip the NEW code has touched
--      (a 'bills_copied' or 'billing_done' activity row), so the re-run never
--      stamps Done on a trip billing is working on — Done is manual (D5).
--      ⚠ The dispatched rule WILL stamp trips that were dispatched between the
--      first run and the re-run and never touched by the new code. That is the
--      legacy rule doing its job; run the re-run promptly.
--
--   PART B is NOT re-runnable as-is (CREATE TABLE has no IF NOT EXISTS, on
--   purpose, and ADD COLUMN fails on a second run). PART C is re-runnable
--   (ON CONFLICT ON CONSTRAINT … DO NOTHING, and "billingDoneAt" IS NULL guards).
--
--   Grants / RLS: none (the trips family issued none).
--
-- ── COLUMNS VERIFIED AGAINST prisma/schema.prisma (2026-10-05) ──────────────
--   trips: status, "sentToBillingAt", "billingCopiedAt", "billingCopiedById",
--          "dispatchedAt" (timestamptz, NOT NULL whenever status = 'dispatched'
--          by chk_trips_dispatched_complete), "updatedAt".
--   trip_activity: "tripId", action, "actorId" (NOT NULL), detail (jsonb),
--          "createdAt".
--   orders: "tripDropId", "isRemoved", "dispatchStatus", "invoiceNo", "obdNumber".
--   trip_drops: id, "tripId".
--   live_changes_child_{ins,upd,del}(): take NO SQL parameters — the trigger
--          arguments ('trip', 'parent', 'tripId') arrive as TG_ARGV, and the
--          functions read the transition tables lc_new / lc_old
--          (sql/2026-09-30-live-changes-step4.sql :265-330, trip_drops :469-477).
-- ============================================================================


-- ============================================================================
-- PART A — SIZING (READ-ONLY). Run this statement ALONE first.
--
-- Simulates PART C without writing anything. ONE grid: sec / k / v, all text.
--   1  trips on Print today (sent, not cancelled), split by billingCopiedAt
--   2  of those, status = 'dispatched'
--   3  copy rows the invoices_copied backfill would write
--   4  trips that would get Done via the invoices_copied match
--   5  trips that would get Done via the dispatched rule (not already in 4)
--   6  of 5: Done but with ≥ 1 non-held bill that has no copy row
--   7  trips that would REMAIN OPEN on Print after both, and their bills
-- ============================================================================

WITH sent AS (
  SELECT t.id, t.status, t."billingCopiedAt"
    FROM trips t
   WHERE t."sentToBillingAt" IS NOT NULL
     AND t.status <> 'cancelled'
),
copied_nos AS (
  SELECT DISTINCT a."tripId", n.no
    FROM trip_activity a
    CROSS JOIN LATERAL jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(a.detail -> 'invoiceNos') = 'array'
                THEN a.detail -> 'invoiceNos' ELSE '[]'::jsonb END) AS n(no)
   WHERE a.action = 'invoices_copied'
     AND a."tripId" IN (SELECT id FROM sent)
),
bills AS (
  SELECT s.id AS trip_id,
         o.id AS order_id,
         EXISTS (SELECT 1 FROM copied_nos c
                  WHERE c."tripId" = s.id AND c.no = o."invoiceNo") AS matched
    FROM sent s
    JOIN trip_drops d ON d."tripId" = s.id
    JOIN orders o     ON o."tripDropId" = d.id AND o."isRemoved" = false
   WHERE o."dispatchStatus" IS DISTINCT FROM 'hold'
),
per_trip AS (
  SELECT s.id, s.status, s."billingCopiedAt",
         count(b.order_id)                         AS eligible,
         count(b.order_id) FILTER (WHERE b.matched) AS matched
    FROM sent s
    LEFT JOIN bills b ON b.trip_id = s.id
   GROUP BY s.id, s.status, s."billingCopiedAt"
),
judged AS (
  SELECT p.*,
         (p."billingCopiedAt" IS NOT NULL AND p.eligible > 0 AND p.matched = p.eligible) AS done_match,
         (p.status = 'dispatched') AS is_disp
    FROM per_trip p
)
SELECT sec, k, v FROM (
  SELECT '1 on print'::text AS sec, 'trips: all / billingCopiedAt null / not null'::text AS k,
         (count(*)::text || ' / ' ||
          (count(*) FILTER (WHERE "billingCopiedAt" IS NULL))::text || ' / ' ||
          (count(*) FILTER (WHERE "billingCopiedAt" IS NOT NULL))::text)::text AS v
    FROM judged
  UNION ALL
  SELECT '2 dispatched'::text, 'status=dispatched: all / copiedAt null / not null'::text,
         ((count(*) FILTER (WHERE is_disp))::text || ' / ' ||
          (count(*) FILTER (WHERE is_disp AND "billingCopiedAt" IS NULL))::text || ' / ' ||
          (count(*) FILTER (WHERE is_disp AND "billingCopiedAt" IS NOT NULL))::text)::text
    FROM judged
  UNION ALL
  SELECT '3 copy rows'::text, 'backfill rows (non-held bills whose invoiceNo was copied)'::text,
         (count(*) FILTER (WHERE matched))::text
    FROM bills
  UNION ALL
  SELECT '4 done: match'::text, 'trips Done via invoices_copied match'::text,
         (count(*) FILTER (WHERE done_match))::text
    FROM judged
  UNION ALL
  SELECT '5 done: dispatched'::text, 'trips Done via dispatched rule (not in 4)'::text,
         (count(*) FILTER (WHERE is_disp AND NOT done_match))::text
    FROM judged
  UNION ALL
  SELECT '6 done w/ gaps'::text, 'of 5: trips with uncopied non-held bills / those bills'::text,
         ((count(*) FILTER (WHERE is_disp AND NOT done_match AND matched < eligible))::text || ' / ' ||
          coalesce(sum(eligible - matched) FILTER (WHERE is_disp AND NOT done_match), 0)::text)::text
    FROM judged
  UNION ALL
  SELECT '7 remain open'::text, 'trips: all / copiedAt null / not null · non-held bills'::text,
         ((count(*) FILTER (WHERE NOT done_match AND NOT is_disp))::text || ' / ' ||
          (count(*) FILTER (WHERE NOT done_match AND NOT is_disp AND "billingCopiedAt" IS NULL))::text || ' / ' ||
          (count(*) FILTER (WHERE NOT done_match AND NOT is_disp AND "billingCopiedAt" IS NOT NULL))::text || ' · ' ||
          coalesce(sum(eligible) FILTER (WHERE NOT done_match AND NOT is_disp), 0)::text)::text
    FROM judged
) x
ORDER BY sec, k;


-- ============================================================================
-- PART B — DDL (plan §4 steps 1–4). Run B + C + D as ONE paste, after PART A.
-- ============================================================================

-- B1 — the table: one row per (trip, bill) billing has copied.
CREATE TABLE trip_bill_copies (
  id            serial         PRIMARY KEY,
  "tripId"      integer        NOT NULL,
  "orderId"     integer        NOT NULL,
  "obdNumber"   text           NOT NULL,   -- snapshot: what went on the clipboard
  "invoiceNo"   text           NULL,       -- snapshot at copy time; screens read orders live
  kind          text           NOT NULL,
  "copiedAt"    timestamptz(6) NOT NULL DEFAULT now(),
  "copiedById"  integer        NULL,       -- NULL only on a 'backfill' row whose actor is unknown
  "createdAt"   timestamptz(6) NOT NULL DEFAULT now()
);

-- RESTRICT, like trip_redeliveries: a trip with history is cancelled, never deleted.
ALTER TABLE trip_bill_copies ADD CONSTRAINT trip_bill_copies_trip_fkey
  FOREIGN KEY ("tripId") REFERENCES trips(id) ON DELETE RESTRICT;
ALTER TABLE trip_bill_copies ADD CONSTRAINT trip_bill_copies_order_fkey
  FOREIGN KEY ("orderId") REFERENCES orders(id) ON DELETE RESTRICT;
-- Default rule (NO ACTION), like trips."createdById".
ALTER TABLE trip_bill_copies ADD CONSTRAINT trip_bill_copies_copied_by_fkey
  FOREIGN KEY ("copiedById") REFERENCES users(id);

-- bulk     = "Copy N OBDs" (every READY bill of the trip)
-- single   = "Copy this one" on a READY bill's panel
-- review   = "Mark done" on a bill with a confirmed pick finding
-- backfill = written by PART C from the old invoices_copied rows
-- A new kind = ALTER this CHECK first, then the vocabulary constant in code.
ALTER TABLE trip_bill_copies ADD CONSTRAINT chk_trip_bill_copies_kind
  CHECK (kind IN ('bulk', 'single', 'review', 'backfill'));
-- Every kind except backfill is a press by a person.
ALTER TABLE trip_bill_copies ADD CONSTRAINT chk_trip_bill_copies_actor
  CHECK (kind = 'backfill' OR "copiedById" IS NOT NULL);

-- The race guard: a second press on the same bill of the same trip is skipped
-- (createMany skipDuplicates / ON CONFLICT DO NOTHING). Also the per-trip find.
ALTER TABLE trip_bill_copies ADD CONSTRAINT trip_bill_copies_trip_order_key
  UNIQUE ("tripId", "orderId");
-- tripId leads the unique above, so it needs no index of its own.
CREATE INDEX trip_bill_copies_order_idx ON trip_bill_copies ("orderId");

COMMENT ON TABLE trip_bill_copies IS
  'Billing Print v2: one row per (trip, bill) billing copied the OBD number of. Keyed per TRIP — a bill moved to another trip reads uncopied there. Never writes orders.';

-- B2 — the trip's Done stamp (D5). billingCopiedAt/ById stay: "latest copy press".
ALTER TABLE trips ADD COLUMN "billingDoneAt"   timestamptz(6) NULL;
ALTER TABLE trips ADD COLUMN "billingDoneById" integer        NULL;
ALTER TABLE trips ADD CONSTRAINT trips_billingDoneById_fkey
  FOREIGN KEY ("billingDoneById") REFERENCES users(id) ON DELETE SET NULL;

-- B3 — activity vocabulary 16 → 18. Fence never down: add _v2, drop, rename.
-- 'invoices_copied' STAYS — its old rows outlive their writer.
ALTER TABLE trip_activity ADD CONSTRAINT chk_trip_activity_action_v2 CHECK (
  action IN ('created', 'bills_added', 'bills_removed', 'vehicle_changed',
             'details_changed', 'cancelled', 'released', 'dispatched', 'renamed',
             'shown', 'taken_back',
             'sent_to_billing', 'taken_back_from_billing', 'invoices_copied',
             'redelivery_added', 'redelivery_removed',
             'bills_copied', 'billing_done')
);
ALTER TABLE trip_activity DROP CONSTRAINT chk_trip_activity_action;
ALTER TABLE trip_activity RENAME CONSTRAINT chk_trip_activity_action_v2 TO chk_trip_activity_action;

-- B4 — live-feed triggers: entity 'trip', parent "tripId" — the trip_drops /
-- trip_redeliveries pattern (sql/2026-09-30-live-changes-step4.sql :469-477).
-- The functions swallow their own failure (RAISE WARNING) — a broken feed never
-- fails the write. trips already carries its own triggers, so B2's columns are
-- covered. Kill switch:
--   ALTER TABLE trip_bill_copies DISABLE TRIGGER trg_live_changes_trip_bill_copies_ins;
--   ALTER TABLE trip_bill_copies DISABLE TRIGGER trg_live_changes_trip_bill_copies_upd;
--   ALTER TABLE trip_bill_copies DISABLE TRIGGER trg_live_changes_trip_bill_copies_del;
DROP TRIGGER IF EXISTS trg_live_changes_trip_bill_copies_ins ON trip_bill_copies;
CREATE TRIGGER trg_live_changes_trip_bill_copies_ins AFTER INSERT ON trip_bill_copies REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_ins('trip', 'parent', 'tripId');
DROP TRIGGER IF EXISTS trg_live_changes_trip_bill_copies_upd ON trip_bill_copies;
CREATE TRIGGER trg_live_changes_trip_bill_copies_upd AFTER UPDATE ON trip_bill_copies REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_upd('trip', 'parent', 'tripId');
DROP TRIGGER IF EXISTS trg_live_changes_trip_bill_copies_del ON trip_bill_copies;
CREATE TRIGGER trg_live_changes_trip_bill_copies_del AFTER DELETE ON trip_bill_copies REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_del('trip', 'parent', 'tripId');


-- ============================================================================
-- PART C — BACKFILL (data). Re-runnable. Run again right after the Print
-- server deploy (see the header).
-- ============================================================================

-- C1 — copy rows from the old invoices_copied history. A non-held bill on a
-- sent, non-cancelled trip whose invoiceNo is in any of that trip's
-- invoices_copied rows gets ONE row, dated by the EARLIEST matching copy.
INSERT INTO trip_bill_copies ("tripId", "orderId", "obdNumber", "invoiceNo", kind, "copiedAt", "copiedById")
SELECT DISTINCT ON (t.id, o.id)
       t.id, o.id, o."obdNumber", o."invoiceNo", 'backfill', a."createdAt", a."actorId"
  FROM trips t
  JOIN trip_drops d    ON d."tripId" = t.id
  JOIN orders o        ON o."tripDropId" = d.id AND o."isRemoved" = false
  JOIN trip_activity a ON a."tripId" = t.id AND a.action = 'invoices_copied'
  CROSS JOIN LATERAL jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(a.detail -> 'invoiceNos') = 'array'
              THEN a.detail -> 'invoiceNos' ELSE '[]'::jsonb END) AS n(no)
 WHERE t."sentToBillingAt" IS NOT NULL
   AND t.status <> 'cancelled'
   AND o."dispatchStatus" IS DISTINCT FROM 'hold'
   AND o."invoiceNo" = n.no
 ORDER BY t.id, o.id, a."createdAt" ASC
ON CONFLICT ON CONSTRAINT trip_bill_copies_trip_order_key DO NOTHING;

-- C2 — Done via the match: the old "copied" state. Every non-held bill now has
-- a copy row, and the trip had an old copy. Skips any trip the NEW code has
-- touched, so a re-run never auto-stamps a trip billing is working on (D5).
UPDATE trips t
   SET "billingDoneAt" = t."billingCopiedAt", "billingDoneById" = t."billingCopiedById"
 WHERE t."sentToBillingAt" IS NOT NULL
   AND t.status <> 'cancelled'
   AND t."billingCopiedAt" IS NOT NULL
   AND t."billingDoneAt" IS NULL
   AND NOT EXISTS (SELECT 1 FROM trip_activity a
                    WHERE a."tripId" = t.id AND a.action IN ('bills_copied', 'billing_done'))
   AND EXISTS (SELECT 1 FROM trip_drops d
                 JOIN orders o ON o."tripDropId" = d.id AND o."isRemoved" = false
                WHERE d."tripId" = t.id AND o."dispatchStatus" IS DISTINCT FROM 'hold')
   AND NOT EXISTS (
         SELECT 1 FROM trip_drops d
           JOIN orders o ON o."tripDropId" = d.id AND o."isRemoved" = false
          WHERE d."tripId" = t.id
            AND o."dispatchStatus" IS DISTINCT FROM 'hold'
            AND NOT EXISTS (SELECT 1 FROM trip_bill_copies c
                             WHERE c."tripId" = t.id AND c."orderId" = o.id));

-- C3 — Done via the dispatched rule (owner, 2026-10-05): every sent,
-- non-cancelled trip that has left the depot is Done, copied or not. A TRIP
-- stamp only — no copy rows for its uncopied bills. "dispatchedAt" is never
-- NULL here (chk_trips_dispatched_complete); "updatedAt" is a belt-and-braces
-- last resort. Same new-code guard as C2.
UPDATE trips t
   SET "billingDoneAt"   = coalesce(t."billingCopiedAt", t."dispatchedAt", t."updatedAt"),
       "billingDoneById" = t."billingCopiedById"
 WHERE t."sentToBillingAt" IS NOT NULL
   AND t.status = 'dispatched'
   AND t."billingDoneAt" IS NULL
   AND NOT EXISTS (SELECT 1 FROM trip_activity a
                    WHERE a."tripId" = t.id AND a.action IN ('bills_copied', 'billing_done'));


-- ============================================================================
-- PART D — READ-BACK (read-only). ONE grid: sec / k / v, all text.
-- Expect:
--   1 constraint : 7 rows — pkey, 3 FKs (2 RESTRICT, 1 default), 2 CHECKs, 1 UNIQUE
--   2 index      : 3 rows — pkey, the unique's index, order_idx
--   3 activity   : 1 row  — 18 values ending 'bills_copied', 'billing_done'
--   4 trigger    : 3 rows — AFTER INSERT / UPDATE / DELETE · STATEMENT
--   5 table col  : 9 rows
--   6 trips col  : 2 rows + the FK
--   7 counts     : copy rows by kind · trips Done · trips still open on Print
-- ============================================================================

SELECT sec, k, v FROM (
  SELECT '1 constraint'::text AS sec, c.conname::text AS k, pg_get_constraintdef(c.oid)::text AS v
    FROM pg_constraint c
   WHERE c.conrelid = 'trip_bill_copies'::regclass
  UNION ALL
  SELECT '2 index'::text, i.indexname::text, i.indexdef::text
    FROM pg_indexes i
   WHERE i.schemaname = 'public' AND i.tablename = 'trip_bill_copies'
  UNION ALL
  SELECT '3 activity'::text, c.conname::text, pg_get_constraintdef(c.oid)::text
    FROM pg_constraint c
   WHERE c.conrelid = 'trip_activity'::regclass AND c.conname::text LIKE 'chk_trip_activity_action%'
  UNION ALL
  SELECT '4 trigger'::text, t.trigger_name::text,
         (t.action_timing::text || ' ' || t.event_manipulation::text || ' · ' ||
          t.action_orientation::text || ' · ' || t.action_statement::text)::text
    FROM information_schema.triggers t
   WHERE t.event_object_table = 'trip_bill_copies'
  UNION ALL
  SELECT '5 table col'::text,
         (lpad(col.ordinal_position::text, 2, '0') || ' ' || col.column_name::text)::text,
         (col.data_type::text || ' · null=' || col.is_nullable::text ||
          ' · default=' || coalesce(col.column_default::text, '—'))::text
    FROM information_schema.columns col
   WHERE col.table_schema = 'public' AND col.table_name = 'trip_bill_copies'
  UNION ALL
  SELECT '6 trips col'::text, col.column_name::text,
         (col.data_type::text || ' · null=' || col.is_nullable::text)::text
    FROM information_schema.columns col
   WHERE col.table_schema = 'public' AND col.table_name = 'trips'
     AND col.column_name IN ('billingDoneAt', 'billingDoneById')
  UNION ALL
  SELECT '6 trips col'::text, c.conname::text, pg_get_constraintdef(c.oid)::text
    FROM pg_constraint c
   WHERE c.conrelid = 'trips'::regclass AND c.conname::text = 'trips_billingDoneById_fkey'
  UNION ALL
  SELECT '7 counts'::text, ('copy rows · kind=' || b.kind::text)::text, count(*)::text
    FROM trip_bill_copies b
   GROUP BY b.kind
  UNION ALL
  SELECT '7 counts'::text, 'trips Done: all / via match (=billingCopiedAt) / dispatched'::text,
         ((count(*) FILTER (WHERE t."billingDoneAt" IS NOT NULL))::text || ' / ' ||
          (count(*) FILTER (WHERE t."billingDoneAt" IS NOT NULL AND t."billingDoneAt" = t."billingCopiedAt"
                             AND t.status <> 'dispatched'))::text || ' / ' ||
          (count(*) FILTER (WHERE t."billingDoneAt" IS NOT NULL AND t.status = 'dispatched'))::text)::text
    FROM trips t
   WHERE t."sentToBillingAt" IS NOT NULL AND t.status <> 'cancelled'
  UNION ALL
  SELECT '7 counts'::text, 'trips still open on Print (sent, not cancelled, not Done)'::text,
         count(*)::text
    FROM trips t
   WHERE t."sentToBillingAt" IS NOT NULL AND t.status <> 'cancelled' AND t."billingDoneAt" IS NULL
) x
ORDER BY sec, k;
