-- sql/2026-09-30-live-changes-tint.sql — LIVE FEED for TINT: the delivery_challans trigger (Schema v27.48)
--
-- Plan of record: docs/prompts/drafts/code-plan-2026-09-30-tint-live-feed.md §B ("Missing triggers"),
--                 §G Step 2, decision 5 (owner: "agree all")
-- Record:         docs/prompts/drafts/code-update-2026-09-30-tint-challan-trigger.md
-- Builds on:      sql/2026-09-30-live-changes.sql (live_changes, v27.45 — applied)
--                 sql/2026-09-30-live-changes-step4.sql (the generic live_changes_child_* functions, v27.46 — applied)
-- Companion:      sql/2026-09-30-live-changes-tint-TEST.sql
--
-- 🟢 INDEPENDENT OF THE BILLING SQL. sql/2026-09-30-live-changes-billing.sql (v27.47, not yet applied)
--   and this file can run in EITHER ORDER, or this one alone:
--   · this file writes entity 'order' only — allowed by chk_live_changes_entity BEFORE and AFTER the
--     Billing widening, so this file does NOT touch the CHECK;
--   · it uses only step 4's functions (already live), which the Billing file does not change;
--   · the two files touch different tables (Billing: mo_orders, so_tags, pick_findings).
--
-- WHAT THIS DOES
--   3 statement-level AFTER triggers on delivery_challans, reusing step 4's generic functions UNCHANGED:
--     delivery_challans → entity 'order', entityId = "orderId"  ('parent' — op 'U': the ORDER changed)
--   No new function. No CHECK change. No Prisma model change.
--
--   WHY — the plan's challan row: the Tint Manager board shows each bill's challan number and the void
--   pre-warning (app/api/tint/manager/orders — `challan: { challanNumber, isVoided }`). Creating, editing
--   or voiding a challan writes delivery_challans and NO orders / tint_assignments / order_splits row
--   (app/api/tint/manager/challans/[orderId] — PATCH; orders/[id]/remove voids it WITH an orders write;
--   manual-entry creates it WITH an orders write). ~48 challan writes/day, and the feed saw none of the
--   edit-only ones. (The polling marker already sees them since bc6362d4 — MAX(delivery_challans."updatedAt").)
--
-- WHAT COUNTS AS A CHANGE — exactly step 4's rule: INSERT / DELETE every row; UPDATE only rows whose
--   to_jsonb(row) - 'updatedAt' differs. delivery_challans."updatedAt" is Prisma's @updatedAt (set by the
--   client; the table has NO trigger today), so a no-op or stamp-only update writes NOTHING (the TEST
--   proves it). "orderId" is NOT NULL (and UNIQUE) in schema.prisma, so every row names an order; the
--   step-4 helper would skip a NULL anyway.
--
-- 🔴 FAILURE DIRECTION — the step-1/step-4 rule: the functions swallow their own failure
--   (RAISE WARNING, RETURN NULL). A broken change book never fails a challan save.
--
-- LOCKS: each CREATE TRIGGER takes a brief SHARE ROW EXCLUSIVE lock on delivery_challans (milliseconds);
--   no table is rewritten. Safe any time; after hours is still the habit.
--
-- HOW TO RUN (Smart Flow, Supabase SQL Editor)
--   a. FIRST the READ-ONLY PRE-CHECK below, on its own (un-comment, run, re-comment).
--   b. Then this whole file ONCE. Re-runnable (DROP TRIGGER IF EXISTS first).
--   c. The last statement is the verification (one UNION ALL result).
--   d. Then sql/2026-09-30-live-changes-tint-TEST.sql — success = ERROR "TEST OK — rolled back (…)".
--   Nothing new READS these lines until a tint screen is on the feed ('live.feed.tint', not built yet);
--   Floor / Billing / Picking already read entity 'order' and simply re-read a bill whose challan changed.
--
-- KILL SWITCH (run on its own; instant; challan writes carry on untouched)
--   ALTER TABLE delivery_challans DISABLE TRIGGER trg_live_changes_delivery_challans_ins;
--   ALTER TABLE delivery_challans DISABLE TRIGGER trg_live_changes_delivery_challans_upd;
--   ALTER TABLE delivery_challans DISABLE TRIGGER trg_live_changes_delivery_challans_del;
--
-- FULL ROLLBACK (removes exactly what this file adds; nothing else depends on it)
--   DROP TRIGGER IF EXISTS trg_live_changes_delivery_challans_ins ON delivery_challans;
--   DROP TRIGGER IF EXISTS trg_live_changes_delivery_challans_upd ON delivery_challans;
--   DROP TRIGGER IF EXISTS trg_live_changes_delivery_challans_del ON delivery_challans;
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- READ-ONLY PRE-CHECK — run on its own FIRST (un-comment, run, re-comment). Expect:
--   · 1 'table' row: delivery_challans
--   · 1 'order FK column' row: orderId · integer · NO   (NO = NOT NULL)
--   · 'required column' rows = the NOT NULL columns with no default — expect orderId, challanNumber,
--     updatedAt (the TEST's insert supplies exactly these; anything else → stop and report)
--   · NO 'check constraint' rows expected (schema.prisma models none; a row → read it before the TEST,
--     whose throw-away insert uses challanNumber 'LCTEST-<txid>')
--   · 1 'rows' row (≈ 2,500 on 2026-09-30)
--   · NO 'existing trigger' rows (a read on 2026-09-30 found none on delivery_challans; any row → stop)
--   · 3 'generic function' rows: live_changes_child_del / _ins / _upd (step 4 applied)
--   · 1 'entity check' row containing 'order'::text — either the 3-entity text (Billing SQL not yet run)
--     or the 5-entity text (Billing SQL run). Both are fine.
--   · 1 'live_changes triggers now' row: 72 before the Billing SQL, 81 after it
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- SELECT 'table'::text AS chk, table_name::text AS detail
--   FROM information_schema.tables
--  WHERE table_schema = 'public' AND table_name = 'delivery_challans'
-- UNION ALL
-- SELECT 'order FK column'::text, column_name::text || ' · ' || data_type::text || ' · ' || is_nullable::text
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'delivery_challans' AND column_name = 'orderId'
-- UNION ALL
-- SELECT 'required column'::text, column_name::text || ' · ' || data_type::text
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'delivery_challans'
--    AND is_nullable = 'NO' AND column_default IS NULL AND is_identity = 'NO'
-- UNION ALL
-- SELECT 'check constraint'::text, conname::text || ' · ' || pg_get_constraintdef(oid)::text
--   FROM pg_constraint
--  WHERE conrelid = 'public.delivery_challans'::regclass AND contype = 'c'
-- UNION ALL
-- SELECT 'rows'::text, count(*)::text FROM delivery_challans
-- UNION ALL
-- SELECT 'existing trigger'::text, tgname::text || ' · ' || tgenabled::text
--   FROM pg_trigger
--  WHERE NOT tgisinternal AND tgrelid = 'public.delivery_challans'::regclass
-- UNION ALL
-- SELECT 'generic function'::text, p.proname::text
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname IN ('live_changes_child_ins', 'live_changes_child_upd', 'live_changes_child_del')
-- UNION ALL
-- SELECT 'entity check'::text, pg_get_constraintdef(oid)::text
--   FROM pg_constraint WHERE conname = 'chk_live_changes_entity'
-- UNION ALL
-- SELECT 'live_changes triggers now'::text, count(*)::text
--   FROM pg_trigger WHERE tgname LIKE 'trg_live_changes_%';
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- 1. The triggers — statement-level AFTER, one per event, each with its transition table(s), on step 4's
--    generic functions (arguments: entity, 'self' | 'parent', key column).
DROP TRIGGER IF EXISTS trg_live_changes_delivery_challans_ins ON delivery_challans;
CREATE TRIGGER trg_live_changes_delivery_challans_ins AFTER INSERT ON delivery_challans REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_ins('order', 'parent', 'orderId');
DROP TRIGGER IF EXISTS trg_live_changes_delivery_challans_upd ON delivery_challans;
CREATE TRIGGER trg_live_changes_delivery_challans_upd AFTER UPDATE ON delivery_challans REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_upd('order', 'parent', 'orderId');
DROP TRIGGER IF EXISTS trg_live_changes_delivery_challans_del ON delivery_challans;
CREATE TRIGGER trg_live_changes_delivery_challans_del AFTER DELETE ON delivery_challans REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_del('order', 'parent', 'orderId');

-- 2. Verification (read-only). The SQL Editor shows only the last result. Expect:
--    · 1 'triggers' row: delivery_challans · "del=O ins=O upd=O";
--    · 1 'all live_changes triggers' row = 75 if the Billing SQL has NOT been run yet
--      (orders 3 + step 4 69 + these 3), or 84 if it has (+ Billing's 9);
--    · 1 'entity check' row (unchanged by this file — 3 or 5 entities, see the pre-check).
SELECT 'triggers'::text AS kind,
       (tgrelid::regclass)::text AS name,
       string_agg(regexp_replace(tgname::text, '^.*_(ins|upd|del)$', '\1') || '=' || tgenabled::text, ' '
                  ORDER BY tgname) AS detail
  FROM pg_trigger
 WHERE tgname LIKE 'trg_live_changes_%' AND tgrelid = 'public.delivery_challans'::regclass
 GROUP BY tgrelid
UNION ALL
SELECT 'all live_changes triggers'::text, 'count'::text, count(*)::text
  FROM pg_trigger WHERE tgname LIKE 'trg_live_changes_%'
UNION ALL
SELECT 'entity check'::text, 'chk_live_changes_entity'::text, pg_get_constraintdef(oid)::text
  FROM pg_constraint WHERE conname = 'chk_live_changes_entity'
ORDER BY 1, 2;
