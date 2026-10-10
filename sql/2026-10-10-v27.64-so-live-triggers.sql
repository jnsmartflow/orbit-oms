-- sql/2026-10-10-v27.64-so-live-triggers.sql — LIVE FEED: the three sales-officer tables (Schema v27.64)
--
-- RUN on live 2026-10-10 · verify 9/9 (all AFTER · STATEMENT · enabled O, on live_changes_config_ins/upd/del).
--   Minted as Schema v27.64 in docs/CLAUDE_CORE.md v139.
--
-- WHY
--   CORE §13: every table a screen reads needs a live_changes trigger. Floor (and, through the shared
--   resolver, the trip sheet) is about to read sales_officer_master ("displayName", name, phone) and
--   sales_officer_aliases (the spelling dictionary, v27.62). customer_sales_officers has been read by
--   Floor's SO column since 2026-10-06 (the division 74/77 cascade) with no trigger — owner decision
--   2026-10-10: close that gap in the same file.
--
-- WHAT THIS DOES
--   9 statement-level AFTER triggers (INSERT / UPDATE / DELETE on each of the 3 tables), the
--   route_master shape from sql/2026-09-30-live-changes-step4.sql VERBATIM, on the EXISTING functions
--   live_changes_config_ins / _upd / _del() — no function is created or replaced here.
--   Each records ONE line per statement: entity 'config', entityId = the TABLE NAME, so an open screen
--   does one (throttled) full reload. UPDATE counts only when a row changed beyond "updatedAt".
--   A failure inside a trigger RAISEs a WARNING and never fails the business write (the functions'
--   own EXCEPTION WHEN OTHERS).
--
-- PRE-CHECK (read-only, run by Claude 2026-10-10 against live): none of the 9 triggers exists today —
--   sales_officer_master 0 user triggers · sales_officer_aliases 0 · customer_sales_officers 0.
--   SELECT c.relname::text, count(t.tgname)::text FROM pg_class c
--     LEFT JOIN pg_trigger t ON t.tgrelid = c.oid AND NOT t.tgisinternal
--    WHERE c.relname IN ('sales_officer_master', 'sales_officer_aliases', 'customer_sales_officers')
--      AND c.relkind = 'r' GROUP BY 1 ORDER BY 1;
--
-- HOW TO RUN (Smart Flow, Supabase SQL Editor): the whole file in ONE paste. Re-runnable
--   (DROP TRIGGER IF EXISTS before each CREATE). Each CREATE takes a brief SHARE ROW EXCLUSIVE lock
--   on its table (milliseconds); nothing is rewritten. No BEGIN/COMMIT. The last statement is the
--   verify — expect 9 rows.
--
-- KILL SWITCH (run on its own; instant, business writes carry on):
--   ALTER TABLE sales_officer_master DISABLE TRIGGER trg_live_changes_sales_officer_master_ins;
--   ALTER TABLE sales_officer_master DISABLE TRIGGER trg_live_changes_sales_officer_master_upd;
--   ALTER TABLE sales_officer_master DISABLE TRIGGER trg_live_changes_sales_officer_master_del;
--   ALTER TABLE sales_officer_aliases DISABLE TRIGGER trg_live_changes_sales_officer_aliases_ins;
--   ALTER TABLE sales_officer_aliases DISABLE TRIGGER trg_live_changes_sales_officer_aliases_upd;
--   ALTER TABLE sales_officer_aliases DISABLE TRIGGER trg_live_changes_sales_officer_aliases_del;
--   ALTER TABLE customer_sales_officers DISABLE TRIGGER trg_live_changes_customer_sales_officers_ins;
--   ALTER TABLE customer_sales_officers DISABLE TRIGGER trg_live_changes_customer_sales_officers_upd;
--   ALTER TABLE customer_sales_officers DISABLE TRIGGER trg_live_changes_customer_sales_officers_del;
--
-- 🔴 A data fix on these tables must never run with SET session_replication_role = replica (or
--   DISABLE TRIGGER) — it would be invisible to every open screen (CORE §13).


-- sales_officer_master
DROP TRIGGER IF EXISTS trg_live_changes_sales_officer_master_ins ON sales_officer_master;
CREATE TRIGGER trg_live_changes_sales_officer_master_ins AFTER INSERT ON sales_officer_master REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_ins();
DROP TRIGGER IF EXISTS trg_live_changes_sales_officer_master_upd ON sales_officer_master;
CREATE TRIGGER trg_live_changes_sales_officer_master_upd AFTER UPDATE ON sales_officer_master REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_upd();
DROP TRIGGER IF EXISTS trg_live_changes_sales_officer_master_del ON sales_officer_master;
CREATE TRIGGER trg_live_changes_sales_officer_master_del AFTER DELETE ON sales_officer_master REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_del();

-- sales_officer_aliases
DROP TRIGGER IF EXISTS trg_live_changes_sales_officer_aliases_ins ON sales_officer_aliases;
CREATE TRIGGER trg_live_changes_sales_officer_aliases_ins AFTER INSERT ON sales_officer_aliases REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_ins();
DROP TRIGGER IF EXISTS trg_live_changes_sales_officer_aliases_upd ON sales_officer_aliases;
CREATE TRIGGER trg_live_changes_sales_officer_aliases_upd AFTER UPDATE ON sales_officer_aliases REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_upd();
DROP TRIGGER IF EXISTS trg_live_changes_sales_officer_aliases_del ON sales_officer_aliases;
CREATE TRIGGER trg_live_changes_sales_officer_aliases_del AFTER DELETE ON sales_officer_aliases REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_del();

-- customer_sales_officers
DROP TRIGGER IF EXISTS trg_live_changes_customer_sales_officers_ins ON customer_sales_officers;
CREATE TRIGGER trg_live_changes_customer_sales_officers_ins AFTER INSERT ON customer_sales_officers REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_ins();
DROP TRIGGER IF EXISTS trg_live_changes_customer_sales_officers_upd ON customer_sales_officers;
CREATE TRIGGER trg_live_changes_customer_sales_officers_upd AFTER UPDATE ON customer_sales_officers REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_upd();
DROP TRIGGER IF EXISTS trg_live_changes_customer_sales_officers_del ON customer_sales_officers;
CREATE TRIGGER trg_live_changes_customer_sales_officers_del AFTER DELETE ON customer_sales_officers REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_del();


-- Verify (read-only, last statement). Expect 9 rows: every one AFTER · STATEMENT · enabled O,
-- calling the matching live_changes_config_* function. The second part adds a row only if a
-- trigger is MISSING (expect none).
SELECT c.relname::text AS table_name,
       t.tgname::text AS trigger_name,
       (CASE WHEN (t.tgtype & 2) <> 0 THEN 'BEFORE' WHEN (t.tgtype & 64) <> 0 THEN 'INSTEAD OF' ELSE 'AFTER' END)::text AS timing,
       (CASE WHEN (t.tgtype & 1) <> 0 THEN 'ROW' ELSE 'STATEMENT' END)::text AS level,
       p.proname::text AS function_name,
       t.tgenabled::text AS enabled
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_proc p ON p.oid = t.tgfoid
 WHERE t.tgname IN (
   'trg_live_changes_sales_officer_master_ins', 'trg_live_changes_sales_officer_master_upd', 'trg_live_changes_sales_officer_master_del',
   'trg_live_changes_sales_officer_aliases_ins', 'trg_live_changes_sales_officer_aliases_upd', 'trg_live_changes_sales_officer_aliases_del',
   'trg_live_changes_customer_sales_officers_ins', 'trg_live_changes_customer_sales_officers_upd', 'trg_live_changes_customer_sales_officers_del'
 )
UNION ALL
SELECT 'MISSING'::text, w.n::text, NULL::text, NULL::text, NULL::text, NULL::text
  FROM unnest(ARRAY[
   'trg_live_changes_sales_officer_master_ins', 'trg_live_changes_sales_officer_master_upd', 'trg_live_changes_sales_officer_master_del',
   'trg_live_changes_sales_officer_aliases_ins', 'trg_live_changes_sales_officer_aliases_upd', 'trg_live_changes_sales_officer_aliases_del',
   'trg_live_changes_customer_sales_officers_ins', 'trg_live_changes_customer_sales_officers_upd', 'trg_live_changes_customer_sales_officers_del'
 ]) AS w(n)
 WHERE NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = w.n)
ORDER BY 1, 2;
