-- sql/2026-10-13-order-invoice-lines-live.sql — LIVE FEED: order_invoice_lines (Add invoices, Phase 4)
--
-- Schema v27.67. ✅ RUN by owner 13 Oct 2026, 6/6 verify (Supabase SQL Editor; pre-check
-- 0 rows, then the whole file in one paste). Live: functions live_changes_order_invoice_lines_
-- ins / _upd / _del present; triggers trg_live_changes_order_invoice_lines_ins / _upd / _del,
-- each AFTER · STATEMENT · its matching function · enabled O. Minted as Schema v27.67 in
-- docs/CLAUDE_CORE.md v143 (chain + §13 trigger list). No table, column or constraint
-- changes: 3 new functions + 3 triggers on order_invoice_lines.
--
-- WHY
--   Phase 4 commit 1 ("invoice rows on board payload") puts each split OBD's invoice
--   LITRES / TINS / KG on the Floor board row (lib/floor/queries.ts getBoardInvoiceRows,
--   from order_invoice_lines). Since v27.66 an Add invoices save edits in place
--   (lib/order-invoices/split.ts applyPlan): a save that only MOVES TINS between existing
--   invoices writes order_invoice_lines alone (steps 5-6) — order_invoices is not
--   touched, so its triggers (v27.65) record nothing and every other open Floor keeps
--   the old litres until a full reload. CORE §13: every table a screen reads needs a
--   live_changes trigger, added with the first screen read — this is that read.
--   (Touching order_invoices."updatedAt" would not help: an UPDATE that changes only
--   "updatedAt" records nothing, by design.)
--
-- WHY NOT live_changes_child_* (sql/2026-09-30-live-changes-step4.sql)
--   Those functions read the parent key off the ROW ITSELF. order_invoice_lines has no
--   "orderId" — its parent is "orderInvoiceId", an order_invoices id — so passing it
--   would publish INVOICE-ROW ids as order ids (the mis-keying CORE §13 warns about).
--   These functions JOIN order_invoices for the OBD, the shape of
--   live_changes_order_invoices_trip_* (sql/2026-10-12-order-invoices-dispatch-unit.sql
--   PART 5).
--
-- WHAT EACH LINE RECORDS
--   entity 'order', "entityId" = the parent OBD (order_invoices."orderId"), op 'U',
--   "sourceTable" 'order_invoice_lines' — so an open Floor re-fetches that bill's row
--   through POST /api/floor/rows (getFloorBoard onlyIds), which carries invoiceRows.
--   DISTINCT per statement: a save re-lining 4 rows of one OBD records ONE line.
--   UPDATE: only rows that changed beyond "updatedAt" count (the table has no
--   "updatedAt" today; the rule is kept so the functions match every other trigger).
--   DELETE by CASCADE (an undo, or a save deleting a manual row): the parent
--   order_invoices row is already gone, so the join finds nothing — and that statement's
--   own order_invoices DELETE trigger has already recorded the OBD. Nothing is lost.
--   A failure inside a trigger RAISEs a WARNING and NEVER fails the business write
--   (EXCEPTION WHEN OTHERS, as every live_changes function).
--
-- PRE-CHECK (read-only — run on its own first; expect 0 rows):
--   SELECT tgname::text FROM pg_trigger
--    WHERE tgrelid = 'public.order_invoice_lines'::regclass AND NOT tgisinternal;
--
-- HOW TO RUN: the whole file in ONE paste (PART 1 then PART 2 then PART 3). Re-runnable
--   (CREATE OR REPLACE FUNCTION; DROP TRIGGER IF EXISTS before each CREATE). Each CREATE
--   TRIGGER takes a brief SHARE ROW EXCLUSIVE lock on order_invoice_lines (milliseconds,
--   4 rows live); nothing is rewritten. No BEGIN/COMMIT. The last statement is the
--   verify — expect 6 rows (3 functions + 3 triggers), no MISSING.
--
-- KILL SWITCH (run on its own; instant, business writes carry on):
--   ALTER TABLE order_invoice_lines DISABLE TRIGGER trg_live_changes_order_invoice_lines_ins;
--   ALTER TABLE order_invoice_lines DISABLE TRIGGER trg_live_changes_order_invoice_lines_upd;
--   ALTER TABLE order_invoice_lines DISABLE TRIGGER trg_live_changes_order_invoice_lines_del;
--
-- 🔴 A data fix on order_invoice_lines must never run with SET session_replication_role =
--   replica (or DISABLE TRIGGER) — it would be invisible to every open screen (CORE §13).


-- ── PART 1 — the three functions ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION live_changes_order_invoice_lines_ins() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    INSERT INTO live_changes (entity, "entityId", op, "sourceTable")
    SELECT DISTINCT 'order', oi."orderId"::text, 'U', 'order_invoice_lines'
      FROM lc_new n
      JOIN order_invoices oi ON oi.id = n."orderInvoiceId";
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live_changes: order_invoice_lines INSERT not recorded (% %) — the write itself succeeded', SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION live_changes_order_invoice_lines_upd() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    WITH changed AS (
      (SELECT to_jsonb(n) - 'updatedAt' AS j FROM lc_new n
       EXCEPT
       SELECT to_jsonb(o) - 'updatedAt' FROM lc_old o)
      UNION
      (SELECT to_jsonb(o) - 'updatedAt' FROM lc_old o
       EXCEPT
       SELECT to_jsonb(n) - 'updatedAt' FROM lc_new n)
    )
    INSERT INTO live_changes (entity, "entityId", op, "sourceTable")
    SELECT DISTINCT 'order', oi."orderId"::text, 'U', 'order_invoice_lines'
      FROM changed c
      JOIN order_invoices oi ON oi.id = (c.j ->> 'orderInvoiceId')::int;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live_changes: order_invoice_lines UPDATE not recorded (% %) — the write itself succeeded', SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION live_changes_order_invoice_lines_del() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    -- A CASCADE delete finds no parent here; the parent's own DELETE trigger recorded it.
    INSERT INTO live_changes (entity, "entityId", op, "sourceTable")
    SELECT DISTINCT 'order', oi."orderId"::text, 'U', 'order_invoice_lines'
      FROM lc_old o
      JOIN order_invoices oi ON oi.id = o."orderInvoiceId";
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live_changes: order_invoice_lines DELETE not recorded (% %) — the write itself succeeded', SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END
$$;


-- ── PART 2 — the three statement-level triggers ──────────────────────────────

DROP TRIGGER IF EXISTS trg_live_changes_order_invoice_lines_ins ON order_invoice_lines;
CREATE TRIGGER trg_live_changes_order_invoice_lines_ins AFTER INSERT ON order_invoice_lines REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_order_invoice_lines_ins();
DROP TRIGGER IF EXISTS trg_live_changes_order_invoice_lines_upd ON order_invoice_lines;
CREATE TRIGGER trg_live_changes_order_invoice_lines_upd AFTER UPDATE ON order_invoice_lines REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_order_invoice_lines_upd();
DROP TRIGGER IF EXISTS trg_live_changes_order_invoice_lines_del ON order_invoice_lines;
CREATE TRIGGER trg_live_changes_order_invoice_lines_del AFTER DELETE ON order_invoice_lines REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_order_invoice_lines_del();


-- ── PART 3 — VERIFY (read-only, last statement) ──────────────────────────────
-- Expect 6 rows: 3 'function' rows and 3 'trigger' rows, every trigger AFTER ·
-- STATEMENT · enabled O, calling the matching live_changes_order_invoice_lines_*
-- function with no arguments. A 'MISSING' row appears only if something is absent.
SELECT 'trigger'::text AS kind,
       t.tgname::text AS name,
       (CASE WHEN (t.tgtype & 2) <> 0 THEN 'BEFORE' WHEN (t.tgtype & 64) <> 0 THEN 'INSTEAD OF' ELSE 'AFTER' END)::text AS timing,
       (CASE WHEN (t.tgtype & 1) <> 0 THEN 'ROW' ELSE 'STATEMENT' END)::text AS level,
       p.proname::text AS function_name,
       t.tgenabled::text AS enabled
  FROM pg_trigger t
  JOIN pg_proc p ON p.oid = t.tgfoid
 WHERE t.tgrelid = 'public.order_invoice_lines'::regclass
   AND t.tgname IN ('trg_live_changes_order_invoice_lines_ins', 'trg_live_changes_order_invoice_lines_upd', 'trg_live_changes_order_invoice_lines_del')
UNION ALL
SELECT 'function'::text, p.proname::text, NULL::text, NULL::text, p.proname::text, NULL::text
  FROM pg_proc p
 WHERE p.proname IN ('live_changes_order_invoice_lines_ins', 'live_changes_order_invoice_lines_upd', 'live_changes_order_invoice_lines_del')
UNION ALL
SELECT 'MISSING'::text, w.n::text, NULL::text, NULL::text, NULL::text, NULL::text
  FROM unnest(ARRAY[
   'trg_live_changes_order_invoice_lines_ins', 'trg_live_changes_order_invoice_lines_upd', 'trg_live_changes_order_invoice_lines_del',
   'live_changes_order_invoice_lines_ins', 'live_changes_order_invoice_lines_upd', 'live_changes_order_invoice_lines_del'
 ]) AS w(n)
 WHERE NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = w.n)
   AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname = w.n)
ORDER BY 1, 2;
