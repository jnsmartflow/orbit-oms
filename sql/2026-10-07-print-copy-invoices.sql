-- ============================================================================
-- 2026-10-07 · Billing Print — "Copy inv" (invoice copy counts toward Done)
--
-- Schema v27.61. ✅ RUN 2026-10-07 by Smart Flow as one guarded DO block
-- (it refused unless the live text matched v27.56); read-back confirmed:
--   chk_trip_bill_copies_kind  CHECK ((kind = ANY (ARRAY['bulk'::text, 'single'::text, 'review'::text, 'backfill'::text, 'invoice'::text])))
--   chk_trip_bill_copies_actor CHECK (((kind = 'backfill'::text) OR ("copiedById" IS NOT NULL)))  — unchanged
--   rows by kind: backfill 39, bulk 369, review 11, invoice 0.
-- The three sections below are the plan as written; the live run used the
-- guarded DO block instead. Recorded in docs/CLAUDE_CORE.md §7 (v27.61).
--
-- PURPOSE. The Print tab gains a second button, "Copy inv". It copies every
-- bill on the trip that HAS an SAP invoice number and has NOT been copied yet
-- (by OBD or by inv) — picking status irrelevant, held bills included — and
-- records each one in trip_bill_copies with kind = 'invoice'. Owner rule
-- (2026-10-07): an invoice number means the bill is final, so invoice copy
-- needs no checks; OBD copy keeps waiting for picking Done.
--
-- Because the record is an ordinary trip_bill_copies row, outstanding /
-- canDone / reopen / getPrintWorkTripIds and the per-row ✓ time all work
-- unchanged (lib/billing/print.ts). UNIQUE ("tripId","orderId") stays: a bill
-- is copied once, by one method.
--
-- THE ONLY DDL: chk_trip_bill_copies_kind gains 'invoice'.
--   · chk_trip_bill_copies_actor needs NO change — an 'invoice' row always has
--     a copiedById (only 'backfill' may be null).
--   · chk_trip_activity_action needs NO change — the press logs the existing
--     'bills_copied' action with detail.kind = 'invoice'. The 2026-10-05 PART C
--     backfill reads only 'invoices_copied' rows (C1) and treats ANY
--     'bills_copied' row as "new code touched this trip" (C2/C3), which an
--     invoice press is.
--
-- ── HOW TO RUN ──────────────────────────────────────────────────────────────
--   Supabase SQL Editor. No BEGIN/COMMIT (CORE §3). The editor shows only the
--   LAST result of a paste, so run each section on its own, in order:
--     1. SECTION 1 alone (read-only). Its chk_trip_bill_copies_kind line MUST be
--          CHECK ((kind = ANY (ARRAY['bulk'::text, 'single'::text, 'review'::text, 'backfill'::text])))
--        (the v27.56 live text, CORE §7 chain). If it differs, STOP — the value
--        list in SECTION 2 would silently drop a live value.
--     2. SECTION 2 (DDL) — the v27.56 fence: add _v2, drop old, rename.
--     3. SECTION 3 alone (read-only) — proves the new definition.
--   🔴 BEFORE any code that writes kind 'invoice' deploys. The CHECK refuses an
--   unknown kind, so code first = every Copy inv press 500s.
-- ============================================================================


-- ============================================================================
-- SECTION 1 — RUN FIRST, ALONE. READ-ONLY. Current live definitions.
-- Expect 2 rows (the activity row is for reference — it is NOT changed here).
-- ============================================================================

SELECT c.conrelid::regclass::text   AS tbl,
       c.conname::text              AS chk,
       pg_get_constraintdef(c.oid)::text AS def
  FROM pg_constraint c
 WHERE (c.conrelid = 'trip_bill_copies'::regclass AND c.conname::text LIKE 'chk_trip_bill_copies_kind%')
    OR (c.conrelid = 'trip_activity'::regclass    AND c.conname::text LIKE 'chk_trip_activity_action%')
 ORDER BY 1, 2;


-- ============================================================================
-- SECTION 2 — DDL. Run only after SECTION 1 matched the expected text above.
-- Existing values from sql/2026-10-05-billing-print-v2.sql (B1) + 'invoice'.
--   bulk     = "Copy N OBDs" (every READY bill of the trip)
--   single   = "Copy this one" on a READY bill's panel
--   review   = "Mark done" on a bill with a confirmed pick finding
--   backfill = written once from the old invoices_copied rows
--   invoice  = "Copy inv": a bill with an SAP invoice number, any picking
--              state, held included (v27.61)
-- ============================================================================

ALTER TABLE trip_bill_copies ADD CONSTRAINT chk_trip_bill_copies_kind_v2
  CHECK (kind IN ('bulk', 'single', 'review', 'backfill', 'invoice'));
ALTER TABLE trip_bill_copies DROP CONSTRAINT chk_trip_bill_copies_kind;
ALTER TABLE trip_bill_copies RENAME CONSTRAINT chk_trip_bill_copies_kind_v2 TO chk_trip_bill_copies_kind;


-- ============================================================================
-- SECTION 3 — READ-BACK, ALONE. READ-ONLY. ONE grid: sec / k / v, all text.
-- Expect:
--   1 kind check : 1 row — chk_trip_bill_copies_kind, 5 values ending 'invoice'
--                  (and NO leftover chk_trip_bill_copies_kind_v2)
--   2 actor check: 1 row — chk_trip_bill_copies_actor, unchanged
--   3 rows/kind  : existing copy rows by kind — unchanged; 0 'invoice' rows
-- ============================================================================

SELECT sec, k, v FROM (
  SELECT '1 kind check'::text AS sec, c.conname::text AS k, pg_get_constraintdef(c.oid)::text AS v
    FROM pg_constraint c
   WHERE c.conrelid = 'trip_bill_copies'::regclass AND c.conname::text LIKE 'chk_trip_bill_copies_kind%'
  UNION ALL
  SELECT '2 actor check'::text, c.conname::text, pg_get_constraintdef(c.oid)::text
    FROM pg_constraint c
   WHERE c.conrelid = 'trip_bill_copies'::regclass AND c.conname::text = 'chk_trip_bill_copies_actor'
  UNION ALL
  SELECT '3 rows/kind'::text, b.kind::text, count(*)::text
    FROM trip_bill_copies b
   GROUP BY b.kind
) x
ORDER BY sec, k;
