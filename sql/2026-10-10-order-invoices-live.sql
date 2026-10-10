-- sql/2026-10-10-order-invoices-live.sql — LIVE FEED: order_invoices (Add invoices, Phase 2)
--
-- Schema v27.65. ✅ RUN by owner 10 Oct 2026 (Supabase SQL Editor, one paste). Verify 3/3, no
-- MISSING — every trigger AFTER · STATEMENT · enabled O, args order\000parent\000orderId\000:
--   trg_live_changes_order_invoices_del → live_changes_child_del
--   trg_live_changes_order_invoices_ins → live_changes_child_ins
--   trg_live_changes_order_invoices_upd → live_changes_child_upd
-- Minted as Schema v27.65 in docs/CLAUDE_CORE.md v140 (chain + §13 trigger list).
--
-- WHY
--   CORE §13: every table a screen reads needs a live_changes trigger, added with the
--   first screen read. Commit "floor: Add invoices modal + detail panel invoices + '+n'
--   chip" is that read: Floor's board rows carry each OBD's typed invoice numbers
--   (lib/floor/queries.ts getAddedInvoiceNos → the "+n" chip) and the detail panel
--   shows the split. Without this, a save on one desk shows on another only at the
--   next full reload.
--
-- WHAT THIS DOES
--   3 statement-level AFTER triggers (INSERT / UPDATE / DELETE) on order_invoices, the
--   so_tag_matches / challan_order_so_links shape VERBATIM, on the EXISTING functions
--   live_changes_child_ins / _upd / _del() (sql/2026-09-30-live-changes-step4.sql) —
--   no function is created or replaced, no CHECK changes (entity 'order' is already
--   admitted by chk_live_changes_entity).
--   Arguments ('order', 'parent', 'orderId'): each changed row records ONE line,
--   entity 'order', entityId = the PARENT order's id, op 'U' — so an open Floor
--   re-fetches that bill's row through POST /api/floor/rows (lib/floor/rows.ts →
--   getFloorBoard onlyIds), which now carries addedInvoiceNos. UPDATE counts only when
--   a row changed beyond "updatedAt". A failure inside a trigger RAISEs a WARNING and
--   never fails the business write (the functions' own EXCEPTION WHEN OTHERS).
--
-- 🔴 order_invoice_lines GETS NO TRIGGER — ON PURPOSE.
--   The child functions read the parent key off the ROW ITSELF; order_invoice_lines has
--   no "orderId" (its parent is "orderInvoiceId", an order_invoices id), so a trigger
--   there would publish INVOICE-ROW ids as order ids — the exact mis-keying CORE §13
--   warns about for freight. It is not needed either: every line write is made in the
--   same press as an order_invoices write (lib/order-invoices/split.ts — a save deletes
--   and re-creates the manual rows; an undo deletes them; their lines CASCADE), so the
--   order_invoices trigger always fires for the same bill. A future line-only write
--   path must also touch order_invoices, or add a join-based function of its own.
--
-- PRE-CHECK (read-only — run on its own first; expect 0 rows):
--   SELECT tgname::text FROM pg_trigger
--    WHERE tgrelid = 'public.order_invoices'::regclass AND NOT tgisinternal;
--
-- HOW TO RUN (Smart Flow, Supabase SQL Editor): the whole file in ONE paste. Re-runnable
--   (DROP TRIGGER IF EXISTS before each CREATE). Each CREATE takes a brief SHARE ROW
--   EXCLUSIVE lock on order_invoices (milliseconds); nothing is rewritten. No
--   BEGIN/COMMIT. The last statement is the verify — expect 3 rows, no MISSING.
--
-- KILL SWITCH (run on its own; instant, business writes carry on):
--   ALTER TABLE order_invoices DISABLE TRIGGER trg_live_changes_order_invoices_ins;
--   ALTER TABLE order_invoices DISABLE TRIGGER trg_live_changes_order_invoices_upd;
--   ALTER TABLE order_invoices DISABLE TRIGGER trg_live_changes_order_invoices_del;
--
-- 🔴 A data fix on order_invoices must never run with SET session_replication_role =
--   replica (or DISABLE TRIGGER) — it would be invisible to every open screen (CORE §13).
--   (The back-fill / PART 3 re-run of sql/2026-10-10-order-invoices-ddl.sql is a plain
--   INSERT … ON CONFLICT and fires these triggers once per statement — harmless.)


DROP TRIGGER IF EXISTS trg_live_changes_order_invoices_ins ON order_invoices;
CREATE TRIGGER trg_live_changes_order_invoices_ins AFTER INSERT ON order_invoices REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_ins('order', 'parent', 'orderId');
DROP TRIGGER IF EXISTS trg_live_changes_order_invoices_upd ON order_invoices;
CREATE TRIGGER trg_live_changes_order_invoices_upd AFTER UPDATE ON order_invoices REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_upd('order', 'parent', 'orderId');
DROP TRIGGER IF EXISTS trg_live_changes_order_invoices_del ON order_invoices;
CREATE TRIGGER trg_live_changes_order_invoices_del AFTER DELETE ON order_invoices REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_del('order', 'parent', 'orderId');


-- Verify (read-only, last statement). Expect 3 rows: every one AFTER · STATEMENT ·
-- enabled O, calling the matching live_changes_child_* function, with arguments
-- order / parent / orderId. The second part adds a row only if a trigger is MISSING.
SELECT c.relname::text AS table_name,
       t.tgname::text AS trigger_name,
       (CASE WHEN (t.tgtype & 2) <> 0 THEN 'BEFORE' WHEN (t.tgtype & 64) <> 0 THEN 'INSTEAD OF' ELSE 'AFTER' END)::text AS timing,
       (CASE WHEN (t.tgtype & 1) <> 0 THEN 'ROW' ELSE 'STATEMENT' END)::text AS level,
       p.proname::text AS function_name,
       t.tgenabled::text AS enabled,
       encode(t.tgargs, 'escape')::text AS args
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_proc p ON p.oid = t.tgfoid
 WHERE t.tgname IN (
   'trg_live_changes_order_invoices_ins', 'trg_live_changes_order_invoices_upd', 'trg_live_changes_order_invoices_del'
 )
UNION ALL
SELECT 'MISSING'::text, w.n::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text
  FROM unnest(ARRAY[
   'trg_live_changes_order_invoices_ins', 'trg_live_changes_order_invoices_upd', 'trg_live_changes_order_invoices_del'
 ]) AS w(n)
 WHERE NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = w.n)
ORDER BY 1, 2;
