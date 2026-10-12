-- ============================================================================
-- 2026-10-12 · Add invoices — PHASES 3-6 SCHEMA: the invoice row becomes the
-- dispatch unit (trip link, hold, dispatched) + per-row keys on copies,
-- re-deliveries and CI.
--
-- Schema v27.66 (CORE v141, chain entry v27.66).
-- ✅ PARTS 1,2,5,3,4,6a,8 run by owner 12 Oct 2026; 6b/6c/7 pending.
--   PART 8 live: rows 18,418 · on trip 3,878 · held 285 · dispatched 7,330 ·
--   with dispatchedAt 506 · mismatches 0/0/0 · copies 508/0 · re-deliveries
--   25/1 (28 waits for 6b) · CI 195/0 · 18648's 4 rows null/false/false ·
--   copy 276 → row 17010 (…716).
--   6b may run once Phase 3 commit 1 (Add invoices save/undo IN PLACE) is
--   DEPLOYED — not merely committed. 6c and 7 wait for the Phase 5 gate.
--
-- Evidence (read-only, scripts/_chk-oi-phase3-20261012.ts, 2026-10-12):
--   orders 18,413 · order_invoices 18,416 · split OBDs 1 (order 18648, 4 rows,
--   4 line rows) · orders on a trip 3,878 (0 of them removed) · held 285
--   (284 live) · held AND on a trip 4 · dispatched 7,330 · held AND dispatched 0
--   · trip_bill_copies 508 · trip_redeliveries 26 · ci_returns 195 ·
--   freight_trip_bills 367 (348 active) · status logs toStage 'dispatched' on
--   506 orders only.
--   Live FK: orders_tripDropId_fkey … REFERENCES trip_drops(id) ON DELETE SET NULL.
--
-- MODEL A (CORE §7.3 v27.63): every OBD has order_invoices rows; unsplit = one
-- seq-1 'sap' row and no line rows; split = n rows, every row with lines.
-- From this version the ROW is the dispatch unit: what truck, held or not,
-- gone or not. Picking, tint, workflowStage and cancel stay per OBD.
--
-- ── NEW COLUMNS ON order_invoices ─────────────────────────────────────────────
--   "tripDropId"     int NULL → trip_drops ON DELETE SET NULL   mirrors orders."tripDropId"
--   "isHeld"         bool NOT NULL DEFAULT false               mirrors orders."dispatchStatus" = 'hold'
--   "heldAt"         timestamptz(6) NULL                        🔴 WALL-CLOCK hold moment.
--                    NOT orders."heldAt" (= the ARRIVAL date, CLAUDE_FLOOR §4.5).
--                    NULL on a back-filled hold = "unknown — use the OBD's
--                    hold-log ladder" (getFloorHold already does).
--   "heldById"       int NULL → users ON DELETE SET NULL        (orders has no held-by column;
--                    today it lives on the hold log row)
--   "isDispatched"   bool NOT NULL DEFAULT false               mirrors orders."workflowStage" = 'dispatched'
--   "dispatchedAt"   timestamptz(6) NULL                        back-fill: the latest
--                    'dispatched' status log if any (506 orders), else NULL
--   "dispatchedById" int NULL → users ON DELETE SET NULL        same source
--
-- ── DERIVED OBD RULES (app-maintained, dual-written while the orders columns
--    still have readers; NOT triggers) ─────────────────────────────────────────
--   live rows   = the OBD's order_invoices rows (all of them; cancel is per OBD).
--   orders."tripDropId"     = "tripDropId" of the LOWEST-seq row that has one;
--                             NULL when no row is on a trip.
--   orders."dispatchStatus" = 'hold' ⇔ EVERY row "isHeld". A partly-held OBD
--                             stays 'dispatch' (it is still going out). When the
--                             last held row is released the OBD takes the
--                             existing unhold rule (bill-actions.ts:361 —
--                             'dispatch' at FLOOR_CLEAR_HOLD_STAGES, else NULL).
--                             Holding ROW-by-row never sets 'hold' from NULL
--                             unless every row is held (same as today's hold).
--   orders."workflowStage"  = 'dispatched' ⇔ every row is "isDispatched" OR
--                             carries a FULL, non-void, non-draft ci_returns
--                             row (orderInvoiceId) — a row that came back whole
--                             is finished too.
--   For an UNSPLIT OBD every rule is the identity: row == OBD.
--
-- ── WHAT IS DECIDED HERE ──────────────────────────────────────────────────────
--   · trip_bill_copies / trip_redeliveries: nullable "orderInvoiceId" → RESTRICT,
--     new UNIQUE ("tripId", "orderInvoiceId") (NULLs distinct — the NULL rows
--     stay governed by the OLD unique). The OLD UNIQUE ("tripId", "orderId")
--     STAYS until Phase 5's gate (see PART 7) — drop it only when every reader
--     and writer keys on orderInvoiceId AND the NULL count is 0.
--   · ci_returns: nullable "orderInvoiceId" → RESTRICT, BACK-FILLED to seq 1 —
--     exact, because every existing CI is on an unsplit OBD (seq 1 = the whole
--     OBD). ci_return_lines UNCHANGED: a CI line already names its rawLineItemId,
--     and the header names the invoice row.
--   · freight_trip_bills: NOT TOUCHED. Freight is a report-only paper trip over
--     held OBDs (CLAUDE_FREIGHT_TRIPS); per OBD is its unit. Phase 6 decides its
--     pool predicate (OBD with ≥1 held row) in code, no DDL.
--   · RESTRICT on every FK into order_invoices: lib/order-invoices/split.ts
--     today DELETES and re-creates the manual rows on every save. With these
--     FKs that delete FAILS LOUDLY once a row is referenced — intended; Phase 3
--     commit 1 changes save/undo to update-in-place and to refuse an edit that
--     would drop a row carrying a trip, hold, dispatch, copy, re-delivery or CI.
--
-- ── BACK-FILL RULE (PART 3) ───────────────────────────────────────────────────
--   ONLY UNSPLIT OBDs are mirrored (exactly one row, no lines): row := OBD.
--   Split OBDs are NEVER touched by this file — they are hand-managed. Today
--   that is order 18648 only, whose OBD is off-trip, not held, not dispatched,
--   so its 4 rows stay at the defaults (tripDropId NULL, isHeld false,
--   isDispatched false) — exactly what "copy to every row" would give.
--   Re-runnable: PART 3 is an IS DISTINCT FROM mirror, so a re-run after
--   imports / trip moves / holds catches up. 🔴 RE-RUN PART 3 (trip half) right
--   after the Phase 3 dual-write deploys, and (hold + dispatched halves) right
--   after Phase 6's dual-write deploys. 🔴 NEVER re-run it after a gate has
--   stopped the writes to the orders column it reads.
--   Copies / re-deliveries / CI on a split OBD stay NULL in PART 4 (today: copy
--   276 and re-delivery 28, both order 18648) — PART 6 holds the owner's hand
--   decision for them (2026-10-12), in three steps with three different times.
--
-- ── LIVE FEED ─────────────────────────────────────────────────────────────────
--   · order_invoices already records entity 'order' (parent "orderId") on any
--     changed row (v27.65) — the new columns ride it. No change.
--   · NEW: order_invoices must ALSO record entity 'trip' for the old/new drop's
--     trip, as orders does (sql/2026-09-30-live-changes.sql). Needed from Phase
--     5, when a row can join or leave a trip WITHOUT orders."tripDropId" moving
--     (713 joins a trip 715 is already on). PART 5. Harmless before then
--     (one duplicate trip line per dual-written press).
--   · trip_bill_copies / trip_redeliveries / ci_returns already carry triggers
--     (trip, trip, order) on their parent keys; a new column changes nothing.
--
-- ── HOW TO RUN (Smart Flow, Supabase SQL Editor) ──────────────────────────────
--   SET statement_timeout = 0; first, in the same tab (CORE §4 — PART 3 updates
--   ~18k rows). No BEGIN/COMMIT. Run each PART on its own, in order. The editor
--   shows only the last result. Every DDL step is guarded and re-runnable.
--   Never with session_replication_role = replica (CORE §13).
-- ============================================================================


-- ============================================================================
-- PART 1 — READ-ONLY PRE-CHECK. Expect: every "must be 0" row 0, and the
-- columns-already-present row 0 on a first run.
-- ============================================================================

SELECT 1 AS k, 'new order_invoices columns already present (0 on first run)'::text AS what,
       count(*)::text AS value
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'order_invoices'
   AND column_name IN ('tripDropId','isHeld','heldAt','heldById','isDispatched','dispatchedAt','dispatchedById')
UNION ALL
SELECT 2, 'orders without a seq-1 row (must be 0 — re-run v27.63 PART 3 first)', count(*)::text
  FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_invoices oi WHERE oi."orderId" = o.id AND oi.seq = 1)
UNION ALL
SELECT 3, 'held AND dispatched orders (must be 0 — chk_order_invoices_held_not_dispatched)', count(*)::text
  FROM orders WHERE "dispatchStatus" = 'hold' AND "workflowStage" = 'dispatched'
UNION ALL
SELECT 4, 'split OBDs (expect 1: order 18648)', count(*)::text
  FROM (SELECT "orderId" FROM order_invoices GROUP BY 1 HAVING count(*) > 1) s
UNION ALL
SELECT 5, 'split OBDs on a trip / held / dispatched (must be 0, else STOP and decide by hand)', count(*)::text
  FROM orders o
 WHERE (o."tripDropId" IS NOT NULL OR o."dispatchStatus" = 'hold' OR o."workflowStage" = 'dispatched')
   AND ((SELECT count(*) FROM order_invoices oi WHERE oi."orderId" = o.id) > 1
     OR EXISTS (SELECT 1 FROM order_invoices oi JOIN order_invoice_lines l ON l."orderInvoiceId" = oi.id WHERE oi."orderId" = o.id))
UNION ALL
SELECT 6, 'user triggers on order_invoices (expect 3 on first run, 6 after PART 5)', count(*)::text
  FROM pg_trigger WHERE tgrelid = 'public.order_invoices'::regclass AND NOT tgisinternal
ORDER BY 1;


-- ============================================================================
-- PART 2 — DDL.
-- Names are Prisma's defaults where the table already uses them
-- (order_invoices, ci_returns) and hand names where the table already does
-- (trip_bill_copies, trip_redeliveries — their schema models carry `map:`).
-- ADD COLUMN … DEFAULT false is metadata-only (PG ≥ 11): no table rewrite.
-- ============================================================================

-- 2a. order_invoices — the dispatch-unit columns.
ALTER TABLE order_invoices ADD COLUMN IF NOT EXISTS "tripDropId"     integer;
ALTER TABLE order_invoices ADD COLUMN IF NOT EXISTS "isHeld"         boolean NOT NULL DEFAULT false;
ALTER TABLE order_invoices ADD COLUMN IF NOT EXISTS "heldAt"         timestamptz(6);
ALTER TABLE order_invoices ADD COLUMN IF NOT EXISTS "heldById"       integer;
ALTER TABLE order_invoices ADD COLUMN IF NOT EXISTS "isDispatched"   boolean NOT NULL DEFAULT false;
ALTER TABLE order_invoices ADD COLUMN IF NOT EXISTS "dispatchedAt"   timestamptz(6);
ALTER TABLE order_invoices ADD COLUMN IF NOT EXISTS "dispatchedById" integer;

DO $$
BEGIN
  -- Same delete rule as orders_tripDropId_fkey: removing a stop returns its
  -- rows to the pool, never deletes an invoice.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_invoices_tripDropId_fkey') THEN
    ALTER TABLE order_invoices ADD CONSTRAINT "order_invoices_tripDropId_fkey"
      FOREIGN KEY ("tripDropId") REFERENCES trip_drops(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_invoices_heldById_fkey') THEN
    ALTER TABLE order_invoices ADD CONSTRAINT "order_invoices_heldById_fkey"
      FOREIGN KEY ("heldById") REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_invoices_dispatchedById_fkey') THEN
    ALTER TABLE order_invoices ADD CONSTRAINT "order_invoices_dispatchedById_fkey"
      FOREIGN KEY ("dispatchedById") REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  -- A stamp only on a row in that state. A held row MAY have NULL heldAt
  -- (back-filled: time unknown); a dispatched row MAY have NULL dispatchedAt.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_order_invoices_hold_shape') THEN
    ALTER TABLE order_invoices ADD CONSTRAINT chk_order_invoices_hold_shape
      CHECK ("isHeld" OR ("heldAt" IS NULL AND "heldById" IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_order_invoices_dispatch_shape') THEN
    ALTER TABLE order_invoices ADD CONSTRAINT chk_order_invoices_dispatch_shape
      CHECK ("isDispatched" OR ("dispatchedAt" IS NULL AND "dispatchedById" IS NULL));
  END IF;
  -- Gone and held at once is nonsense (live: 0 such orders, PART 1 row 3).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_order_invoices_held_not_dispatched') THEN
    ALTER TABLE order_invoices ADD CONSTRAINT chk_order_invoices_held_not_dispatched
      CHECK (NOT ("isHeld" AND "isDispatched"));
  END IF;
END
$$;

-- "Which rows are on this stop" — trip detail, stop totals, deleteTripDropIfEmpty.
CREATE INDEX IF NOT EXISTS "order_invoices_tripDropId_idx" ON order_invoices ("tripDropId");
-- The On hold tab per row: ~285 of 18k rows. PARTIAL — not modellable in
-- Prisma; recorded as a model comment, never @@index.
CREATE INDEX IF NOT EXISTS "order_invoices_held_idx" ON order_invoices ("orderId") WHERE "isHeld";
-- No index on heldById / dispatchedById (actor FKs; house practice, as orders).

-- 2b. trip_bill_copies — per invoice row.
ALTER TABLE trip_bill_copies ADD COLUMN IF NOT EXISTS "orderInvoiceId" integer;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_bill_copies_order_invoice_fkey') THEN
    ALTER TABLE trip_bill_copies ADD CONSTRAINT trip_bill_copies_order_invoice_fkey
      FOREIGN KEY ("orderInvoiceId") REFERENCES order_invoices(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_bill_copies_trip_invoice_key') THEN
    ALTER TABLE trip_bill_copies ADD CONSTRAINT trip_bill_copies_trip_invoice_key
      UNIQUE ("tripId", "orderInvoiceId");
  END IF;
END
$$;
CREATE INDEX IF NOT EXISTS trip_bill_copies_invoice_idx ON trip_bill_copies ("orderInvoiceId");

-- 2c. trip_redeliveries — per invoice row.
ALTER TABLE trip_redeliveries ADD COLUMN IF NOT EXISTS "orderInvoiceId" integer;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_redeliveries_order_invoice_fkey') THEN
    ALTER TABLE trip_redeliveries ADD CONSTRAINT trip_redeliveries_order_invoice_fkey
      FOREIGN KEY ("orderInvoiceId") REFERENCES order_invoices(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_redeliveries_trip_invoice_key') THEN
    ALTER TABLE trip_redeliveries ADD CONSTRAINT trip_redeliveries_trip_invoice_key
      UNIQUE ("tripId", "orderInvoiceId");
  END IF;
END
$$;
CREATE INDEX IF NOT EXISTS trip_redeliveries_invoice_idx ON trip_redeliveries ("orderInvoiceId");

-- 2d. ci_returns — which invoice came back. orderId stays the bill identity
-- (CLAUDE_CI §5); orderInvoiceId narrows it to one invoice row.
ALTER TABLE ci_returns ADD COLUMN IF NOT EXISTS "orderInvoiceId" integer;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ci_returns_orderInvoiceId_fkey') THEN
    ALTER TABLE ci_returns ADD CONSTRAINT "ci_returns_orderInvoiceId_fkey"
      FOREIGN KEY ("orderInvoiceId") REFERENCES order_invoices(id) ON DELETE RESTRICT;
  END IF;
END
$$;
CREATE INDEX IF NOT EXISTS "ci_returns_orderInvoiceId_idx" ON ci_returns ("orderInvoiceId");


-- ============================================================================
-- PART 3 — BACK-FILL / MIRROR. UNSPLIT OBDs ONLY (exactly one row, no lines).
-- Re-runnable (IS DISTINCT FROM). Removed orders included — the v27.63 rule
-- "every order has a seq-1 row, no exceptions" holds here too.
-- ============================================================================

-- 3a. Trip link. Expect ~3,878 rows on first run.
UPDATE order_invoices oi
   SET "tripDropId" = o."tripDropId", "updatedAt" = now()
  FROM orders o
 WHERE oi."orderId" = o.id
   AND oi.seq = 1
   AND NOT EXISTS (SELECT 1 FROM order_invoices x WHERE x."orderId" = oi."orderId" AND x.seq <> 1)
   AND NOT EXISTS (SELECT 1 FROM order_invoice_lines l WHERE l."orderInvoiceId" = oi.id)
   AND oi."tripDropId" IS DISTINCT FROM o."tripDropId";

-- 3b. Hold. Expect ~285 rows on first run. heldAt / heldById stay NULL on a
-- back-filled hold (wall-clock unknown here; readers keep the hold-log ladder).
-- A row that is no longer held loses its stamps (chk_order_invoices_hold_shape).
UPDATE order_invoices oi
   SET "isHeld"   = (o."dispatchStatus" IS NOT DISTINCT FROM 'hold'),
       "heldAt"   = CASE WHEN o."dispatchStatus" IS NOT DISTINCT FROM 'hold' THEN oi."heldAt"   END,
       "heldById" = CASE WHEN o."dispatchStatus" IS NOT DISTINCT FROM 'hold' THEN oi."heldById" END,
       "updatedAt" = now()
  FROM orders o
 WHERE oi."orderId" = o.id
   AND oi.seq = 1
   AND NOT EXISTS (SELECT 1 FROM order_invoices x WHERE x."orderId" = oi."orderId" AND x.seq <> 1)
   AND NOT EXISTS (SELECT 1 FROM order_invoice_lines l WHERE l."orderInvoiceId" = oi.id)
   AND oi."isHeld" IS DISTINCT FROM (o."dispatchStatus" IS NOT DISTINCT FROM 'hold');

-- 3c. Dispatched. Expect ~7,330 rows on first run; dispatchedAt / ById from the
-- LATEST toStage='dispatched' status log where one exists (~506), else NULL.
UPDATE order_invoices oi
   SET "isDispatched"   = (o."workflowStage" = 'dispatched'),
       "dispatchedAt"   = CASE WHEN o."workflowStage" = 'dispatched' THEN lg."createdAt"   END,
       "dispatchedById" = CASE WHEN o."workflowStage" = 'dispatched' THEN lg."changedById" END,
       "updatedAt" = now()
  FROM orders o
  LEFT JOIN LATERAL (
    SELECT l."createdAt", l."changedById"
      FROM order_status_logs l
     WHERE l."orderId" = o.id AND l."toStage" = 'dispatched'
     ORDER BY l."createdAt" DESC, l.id DESC
     LIMIT 1
  ) lg ON true
 WHERE oi."orderId" = o.id
   AND oi.seq = 1
   AND NOT EXISTS (SELECT 1 FROM order_invoices x WHERE x."orderId" = oi."orderId" AND x.seq <> 1)
   AND NOT EXISTS (SELECT 1 FROM order_invoice_lines l2 WHERE l2."orderInvoiceId" = oi.id)
   AND oi."isDispatched" IS DISTINCT FROM (o."workflowStage" = 'dispatched');


-- ============================================================================
-- PART 4 — BACK-FILL the per-row keys on copies, re-deliveries, CI.
-- Seq-1 row of an UNSPLIT OBD only; split OBDs stay NULL (PART 6).
-- Only fills NULLs — never rewrites a key already set. Re-runnable.
-- ============================================================================

UPDATE trip_bill_copies c
   SET "orderInvoiceId" = oi.id
  FROM order_invoices oi
 WHERE c."orderInvoiceId" IS NULL
   AND oi."orderId" = c."orderId" AND oi.seq = 1
   AND NOT EXISTS (SELECT 1 FROM order_invoices x WHERE x."orderId" = oi."orderId" AND x.seq <> 1)
   AND NOT EXISTS (SELECT 1 FROM order_invoice_lines l WHERE l."orderInvoiceId" = oi.id);

UPDATE trip_redeliveries r
   SET "orderInvoiceId" = oi.id
  FROM order_invoices oi
 WHERE r."orderInvoiceId" IS NULL
   AND oi."orderId" = r."orderId" AND oi.seq = 1
   AND NOT EXISTS (SELECT 1 FROM order_invoices x WHERE x."orderId" = oi."orderId" AND x.seq <> 1)
   AND NOT EXISTS (SELECT 1 FROM order_invoice_lines l WHERE l."orderInvoiceId" = oi.id);

UPDATE ci_returns c
   SET "orderInvoiceId" = oi.id
  FROM order_invoices oi
 WHERE c."orderInvoiceId" IS NULL
   AND oi."orderId" = c."orderId" AND oi.seq = 1
   AND NOT EXISTS (SELECT 1 FROM order_invoices x WHERE x."orderId" = oi."orderId" AND x.seq <> 1)
   AND NOT EXISTS (SELECT 1 FROM order_invoice_lines l WHERE l."orderInvoiceId" = oi.id);


-- ============================================================================
-- PART 5 — LIVE FEED: trip lines from order_invoices.
-- order_invoices already records entity 'order' (v27.65). These three record
-- entity 'trip' for every trip whose stop a changed row was on BEFORE or is on
-- AFTER — the orders-trigger shape (sql/2026-09-30-live-changes.sql:146-210),
-- trip half only. Same failure direction: WARN, never fail the business write.
-- Same change rule: an UPDATE that moves only "updatedAt" records nothing.
-- 'trip' is already admitted by chk_live_changes_entity.
-- ============================================================================

CREATE OR REPLACE FUNCTION live_changes_order_invoices_trip_ins() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    INSERT INTO live_changes (entity, "entityId", op, "sourceTable")
    SELECT DISTINCT 'trip', d."tripId"::text, 'U', 'order_invoices'
      FROM lc_new n JOIN trip_drops d ON d.id = n."tripDropId";
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live_changes: order_invoices INSERT trip lines not recorded (% %) — the write itself succeeded', SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION live_changes_order_invoices_trip_upd() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    WITH changed AS (
      SELECT n."tripDropId" AS new_drop, o."tripDropId" AS old_drop
        FROM lc_new n
        JOIN lc_old o ON o.id = n.id
       WHERE (to_jsonb(n) - 'updatedAt') IS DISTINCT FROM (to_jsonb(o) - 'updatedAt')
    ),
    drops AS (
      SELECT new_drop AS drop_id FROM changed WHERE new_drop IS NOT NULL
      UNION
      SELECT old_drop FROM changed WHERE old_drop IS NOT NULL
    )
    INSERT INTO live_changes (entity, "entityId", op, "sourceTable")
    SELECT DISTINCT 'trip', d."tripId"::text, 'U', 'order_invoices'
      FROM drops x JOIN trip_drops d ON d.id = x.drop_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live_changes: order_invoices UPDATE trip lines not recorded (% %) — the write itself succeeded', SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION live_changes_order_invoices_trip_del() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    INSERT INTO live_changes (entity, "entityId", op, "sourceTable")
    SELECT DISTINCT 'trip', d."tripId"::text, 'U', 'order_invoices'
      FROM lc_old o JOIN trip_drops d ON d.id = o."tripDropId";
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live_changes: order_invoices DELETE trip lines not recorded (% %) — the write itself succeeded', SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_live_changes_order_invoices_trip_ins ON order_invoices;
CREATE TRIGGER trg_live_changes_order_invoices_trip_ins AFTER INSERT ON order_invoices REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_order_invoices_trip_ins();
DROP TRIGGER IF EXISTS trg_live_changes_order_invoices_trip_upd ON order_invoices;
CREATE TRIGGER trg_live_changes_order_invoices_trip_upd AFTER UPDATE ON order_invoices REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_order_invoices_trip_upd();
DROP TRIGGER IF EXISTS trg_live_changes_order_invoices_trip_del ON order_invoices;
CREATE TRIGGER trg_live_changes_order_invoices_trip_del AFTER DELETE ON order_invoices REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_order_invoices_trip_del();
-- ⚠ Run PART 5 BEFORE PART 3 if you want the back-fill to publish trip lines
-- (≈ one line per trip touched — harmless either way; open screens reload).


-- ============================================================================
-- PART 6 — OWNER DECISION for order 18648 (OBD 9109951956), 2026-10-12.
-- Rows: 17010 = …716 (seq 1, SAP) · 36798 = …713 · 36799 = …714 · 36800 = …715.
-- Real world (owner): 713 + 715 went on re-delivery trip L-261007-20 (7 Oct,
-- re-delivery 28, "460 LTR JASE" = 260 + 200 L). 716 + 714 are on hold. None of
-- it went on L-261006-05 (trip note "1000 LTR didn't go on this trip").
--
-- 🔴 NO TRIP AND NO HOLD IS SET ON 18648's ROWS HERE. The owner records them in
-- the app once Phases 5-6 ship. After this PART all 4 rows stay
-- "tripDropId" NULL · "isHeld" false · "heldAt" NULL · "isDispatched" false,
-- and orders 18648 is untouched ('dispatch', "tripDropId" NULL, pick_checked).
--
-- Every statement names its target by id AND re-checks order, trip and invoice
-- number, so a wrong id matches 0 rows instead of the wrong row. Each fills
-- NULLs only → re-running is a no-op. freight_trip_bills 188: NOT TOUCHED.
--
-- Three steps, three different times:
--   6a  RUN NOW    copy 276 → row 17010 (seq 1). seq 1 is never deleted by
--                  Add invoices save/undo, so a RESTRICT link to it is safe today.
--   6b  RUN LATER  re-delivery 28 → row 36798 (713). ⚠ NOT before Phase 3
--                  commit 1 (save/undo update in place) is live: today's save
--                  deletes seq 1's lines FIRST, then the manual rows — with a
--                  RESTRICT link on 36798 the second delete fails and leaves
--                  18648 half-split (seq 1 without lines, manual rows intact).
--   6c  RUN LATER  a SECOND re-delivery row for 715 (row 36800), a copy of 28.
--                  Only AFTER PART 7: the old UNIQUE ("tripId","orderId") forbids
--                  two re-delivery rows for one OBD on trip 668 until then. The
--                  statement checks that the old unique is gone and inserts 0
--                  rows while it exists. If the owner re-delivers 715 through
--                  the app first, the NOT EXISTS makes 6c a no-op.
-- ============================================================================

-- 6a. RUN NOW. Copy 276 (L-261006-05, 'bulk', whole OBD before the split) → seq 1 (…716).
UPDATE trip_bill_copies c
   SET "orderInvoiceId" = oi.id
  FROM order_invoices oi
 WHERE c.id = 276
   AND c."orderId" = 18648
   AND c."tripId" = 605
   AND c."orderInvoiceId" IS NULL
   AND oi.id = 17010
   AND oi."orderId" = 18648
   AND oi.seq = 1
   AND right(oi."invoiceNo", 3) = '716';

-- 6b. RUN LATER — after Phase 3 commit 1 is deployed. Re-delivery 28 → …713.
-- "invoiceNo" on 28 is an add-time snapshot (screens read live) — left as is.
-- UPDATE trip_redeliveries r
--    SET "orderInvoiceId" = oi.id
--   FROM order_invoices oi
--  WHERE r.id = 28
--    AND r."orderId" = 18648
--    AND r."tripId" = 668
--    AND r."orderInvoiceId" IS NULL
--    AND oi.id = 36798
--    AND oi."orderId" = 18648
--    AND right(oi."invoiceNo", 3) = '713';

-- 6c. RUN LATER — after PART 7. One new trip_redeliveries row for …715: same
-- trip, stop, attempt, previous trip, reason, note, return tick, time and
-- author as 28 (it is the same real event); "invoiceNo" = 715's number.
-- Writes exactly 1 row, once; fires the existing trip live line for trip 668.
-- INSERT INTO trip_redeliveries
--        ("tripId", "tripDropId", "orderId", "obdNumber", "invoiceNo", "attemptNo", "prevTripId",
--         reason, note, "confirmedReturn", "createdAt", "createdById", "updatedAt", "orderInvoiceId")
-- SELECT r."tripId", r."tripDropId", r."orderId", r."obdNumber", oi."invoiceNo", r."attemptNo", r."prevTripId",
--        r.reason, r.note, r."confirmedReturn", r."createdAt", r."createdById", now(), oi.id
--   FROM trip_redeliveries r
--   JOIN order_invoices oi ON oi.id = 36800 AND oi."orderId" = 18648 AND right(oi."invoiceNo", 3) = '715'
--  WHERE r.id = 28
--    AND r."orderId" = 18648
--    AND r."tripId" = 668
--    AND r."orderInvoiceId" = 36798
--    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_redeliveries_trip_order_key')
--    AND NOT EXISTS (SELECT 1 FROM trip_redeliveries x WHERE x."tripId" = r."tripId" AND x."orderInvoiceId" = oi.id);

-- 6d. Read-back (read-only). Expect after 6a: copy 276 → 17010 (…716),
-- re-delivery 28 → null; after 6b: 28 → 36798; after 6c: + a row → 36800.
SELECT 'copy ' || c.id::text AS what, 'trip ' || c."tripId"::text || ' → row ' || coalesce(c."orderInvoiceId"::text, 'null') || ' ' || coalesce(oi."invoiceNo", '')::text AS value
  FROM trip_bill_copies c LEFT JOIN order_invoices oi ON oi.id = c."orderInvoiceId"
 WHERE c."orderId" = 18648
UNION ALL
SELECT 'redelivery ' || r.id::text, 'trip ' || r."tripId"::text || ' → row ' || coalesce(r."orderInvoiceId"::text, 'null') || ' ' || coalesce(oi."invoiceNo", '')::text
  FROM trip_redeliveries r LEFT JOIN order_invoices oi ON oi.id = r."orderInvoiceId"
 WHERE r."orderId" = 18648
UNION ALL
SELECT 'row ' || oi.id::text || ' seq ' || oi.seq::text,
       coalesce(oi."invoiceNo", '')::text || ' · tripDropId ' || coalesce(oi."tripDropId"::text, 'null') || ' · held ' || oi."isHeld"::text || ' · dispatched ' || oi."isDispatched"::text
  FROM order_invoices oi
 WHERE oi."orderId" = 18648
ORDER BY 1;


-- ============================================================================
-- PART 7 — LATER, NOT NOW. The Phase 5 gate. COMMENTED OUT.
-- Run only when (a) every reader/writer of trip_bill_copies / trip_redeliveries
-- keys on "orderInvoiceId" (lib/billing/print.ts, lib/trips/redelivery.ts,
-- lib/trips/queries.ts, lib/trip-sheet/load.ts, cancel route), (b) PART 8 shows
-- 0 NULL "orderInvoiceId" on both tables (needs PART 6b done), (c) one full day
-- live on the new code. Then run PART 6c.
--   ALTER TABLE trip_bill_copies  ALTER COLUMN "orderInvoiceId" SET NOT NULL;
--   ALTER TABLE trip_redeliveries ALTER COLUMN "orderInvoiceId" SET NOT NULL;
--   ALTER TABLE trip_bill_copies  DROP CONSTRAINT trip_bill_copies_trip_order_key;
--   ALTER TABLE trip_redeliveries DROP CONSTRAINT trip_redeliveries_trip_order_key;
-- (Keep trip_bill_copies_order_idx / trip_redeliveries_order_idx — orderId stays
-- as a denormalised read key.)
-- ============================================================================


-- ============================================================================
-- PART 8 — RUN LAST, ALONE. READ-ONLY VERIFICATION.
-- Expected on a first run (live 2026-10-12; moves with imports / trip moves):
--   1 order_invoices rows ............................ 18,416
--   2 rows on a trip ................................. 3,878  (= orders on a trip)
--   3 rows held ...................................... 285
--   4 rows dispatched ................................ 7,330
--   5 dispatched rows with dispatchedAt .............. ~506
--   6-8 unsplit mirror differs (trip / hold / dispatched) ... 0 / 0 / 0
--   9 trip_bill_copies keyed / NULL .................. 508 / 0   (6a linked copy 276)
--  10 trip_redeliveries keyed / NULL ................. 25 / 1    (NULL = re-delivery 28
--                                                     until 6b → 26 / 0; after 6c 27 / 0)
--  11 ci_returns keyed / NULL ........................ 195 / 0
--  12 order 18648 rows: 4 lines, each "tripDropId null · held false · dispatched false"
--  13 order 18648 copy 276 ........................... trip 605 → row 17010 (…716)
--  14 order 18648 re-delivery 28 ..................... trip 668 → row null (36798 after 6b)
--  20 constraint rows: order_invoices 14 (8 + 3 FK + 3 CHECK),
--     trip_bill_copies 2 new, trip_redeliveries 2 new, ci_returns 1 new
--     (plus the two OLD uniques, listed to show they are still there)
--  30 index rows: 5 new
--  40 trigger rows: order_invoices 6, all enabled O
-- ============================================================================

SELECT 1 AS k, 'order_invoices rows'::text AS what, count(*)::text AS value FROM order_invoices
UNION ALL
SELECT 2, 'rows on a trip', count(*)::text FROM order_invoices WHERE "tripDropId" IS NOT NULL
UNION ALL
SELECT 3, 'rows held', count(*)::text FROM order_invoices WHERE "isHeld"
UNION ALL
SELECT 4, 'rows dispatched', count(*)::text FROM order_invoices WHERE "isDispatched"
UNION ALL
SELECT 5, 'dispatched rows with dispatchedAt', count(*)::text FROM order_invoices WHERE "isDispatched" AND "dispatchedAt" IS NOT NULL
UNION ALL
SELECT 6, 'unsplit: trip differs from orders (must be 0)', count(*)::text
  FROM order_invoices oi JOIN orders o ON o.id = oi."orderId"
 WHERE oi.seq = 1
   AND NOT EXISTS (SELECT 1 FROM order_invoices x WHERE x."orderId" = oi."orderId" AND x.seq <> 1)
   AND NOT EXISTS (SELECT 1 FROM order_invoice_lines l WHERE l."orderInvoiceId" = oi.id)
   AND oi."tripDropId" IS DISTINCT FROM o."tripDropId"
UNION ALL
SELECT 7, 'unsplit: hold differs from orders (must be 0)', count(*)::text
  FROM order_invoices oi JOIN orders o ON o.id = oi."orderId"
 WHERE oi.seq = 1
   AND NOT EXISTS (SELECT 1 FROM order_invoices x WHERE x."orderId" = oi."orderId" AND x.seq <> 1)
   AND NOT EXISTS (SELECT 1 FROM order_invoice_lines l WHERE l."orderInvoiceId" = oi.id)
   AND oi."isHeld" IS DISTINCT FROM (o."dispatchStatus" IS NOT DISTINCT FROM 'hold')
UNION ALL
SELECT 8, 'unsplit: dispatched differs from orders (must be 0)', count(*)::text
  FROM order_invoices oi JOIN orders o ON o.id = oi."orderId"
 WHERE oi.seq = 1
   AND NOT EXISTS (SELECT 1 FROM order_invoices x WHERE x."orderId" = oi."orderId" AND x.seq <> 1)
   AND NOT EXISTS (SELECT 1 FROM order_invoice_lines l WHERE l."orderInvoiceId" = oi.id)
   AND oi."isDispatched" IS DISTINCT FROM (o."workflowStage" = 'dispatched')
UNION ALL
SELECT 9, 'trip_bill_copies keyed / NULL', count("orderInvoiceId")::text || ' / ' || (count(*) - count("orderInvoiceId"))::text FROM trip_bill_copies
UNION ALL
SELECT 10, 'trip_redeliveries keyed / NULL', count("orderInvoiceId")::text || ' / ' || (count(*) - count("orderInvoiceId"))::text FROM trip_redeliveries
UNION ALL
SELECT 11, 'ci_returns keyed / NULL', count("orderInvoiceId")::text || ' / ' || (count(*) - count("orderInvoiceId"))::text FROM ci_returns
UNION ALL
SELECT 12, 'order 18648 · seq ' || oi.seq::text || ' · ' || coalesce(oi."invoiceNo", '—')::text,
       'tripDropId ' || coalesce(oi."tripDropId"::text, 'null') || ' · held ' || oi."isHeld"::text || ' · dispatched ' || oi."isDispatched"::text
  FROM order_invoices oi WHERE oi."orderId" = 18648
UNION ALL
SELECT 13, 'order 18648 · copy ' || c.id::text,
       'trip ' || c."tripId"::text || ' → row ' || coalesce(c."orderInvoiceId"::text, 'null') || ' ' || coalesce(oi."invoiceNo", '')::text
  FROM trip_bill_copies c LEFT JOIN order_invoices oi ON oi.id = c."orderInvoiceId"
 WHERE c."orderId" = 18648
UNION ALL
SELECT 14, 'order 18648 · re-delivery ' || r.id::text,
       'trip ' || r."tripId"::text || ' → row ' || coalesce(r."orderInvoiceId"::text, 'null') || ' ' || coalesce(oi."invoiceNo", '')::text
  FROM trip_redeliveries r LEFT JOIN order_invoices oi ON oi.id = r."orderInvoiceId"
 WHERE r."orderId" = 18648
UNION ALL
SELECT 20, c.conrelid::regclass::text || ' · ' || c.conname::text, pg_get_constraintdef(c.oid)::text
  FROM pg_constraint c
 WHERE c.conrelid = 'public.order_invoices'::regclass
    OR c.conname IN ('trip_bill_copies_order_invoice_fkey', 'trip_bill_copies_trip_invoice_key', 'trip_bill_copies_trip_order_key',
                     'trip_redeliveries_order_invoice_fkey', 'trip_redeliveries_trip_invoice_key', 'trip_redeliveries_trip_order_key',
                     'ci_returns_orderInvoiceId_fkey')
UNION ALL
SELECT 30, 'index · ' || indexname::text, indexdef::text
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND indexname IN ('order_invoices_tripDropId_idx', 'order_invoices_held_idx', 'trip_bill_copies_invoice_idx',
                     'trip_redeliveries_invoice_idx', 'ci_returns_orderInvoiceId_idx')
UNION ALL
SELECT 40, 'trigger · ' || t.tgname::text, ('enabled ' || t.tgenabled::text || ' · ' || p.proname::text)::text
  FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
 WHERE t.tgrelid = 'public.order_invoices'::regclass AND NOT t.tgisinternal
ORDER BY 1, 2;
