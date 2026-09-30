-- sql/2026-09-30-live-changes-billing.sql — LIVE FEED for BILLING (2b-i): two new entities + 9 triggers (Schema v27.47)
--
-- Plan of record: docs/prompts/drafts/code-plan-2026-09-30-billing-live-feed.md §D ("New triggers needed"),
--                 decisions 3 + 6 (owner approved all 11)
-- Record:         docs/prompts/drafts/code-update-2026-09-30-billing-live-feed-2b-i.md
-- Builds on:      sql/2026-09-30-live-changes.sql (live_changes, v27.45 — applied)
--                 sql/2026-09-30-live-changes-step4.sql (the generic live_changes_child_* functions, v27.46 — applied)
-- Companion:      sql/2026-09-30-live-changes-billing-TEST.sql
--
-- WHAT THIS DOES
--   1. Widens chk_live_changes_entity from ('order','trip','config') to
--      ('order','trip','config','mail_order','so_tag').
--   2. Adds 9 statement-level AFTER triggers, reusing step 4's generic functions UNCHANGED:
--        mo_orders    → entity 'mail_order', entityId = mo_orders.id   ('self' — op = the row's own I/U/D)
--        so_tags      → entity 'so_tag',     entityId = so_tags.id     ('self')
--        pick_findings→ entity 'order',      entityId = "orderId"      ('parent' — op 'U')
--   No new function. No Prisma model change (live_changes' CHECK is not modelled).
--
--   WHY EACH
--   · mo_orders — the Billing ORDERS tab (mail orders) had no trigger; its 30 s marker watches
--     MAX(mo_orders."updatedAt"). Every one of the eleven mail-order write routes ends on a mo_orders
--     write (app/api/mail-orders/marker/route.ts header), so one trigger here covers what the marker
--     covers. mo_order_lines / mo_order_remarks are NOT triggered for that reason; mo_line_status is the
--     marker's own accepted gap (11 rows ever).
--   · so_tags — the Telephonic tab's waiting count. Adding, removing or matching a tag writes so_tags
--     (so_tag_matches is triggered since step 4, so_tags was not).
--   · pick_findings — confirming or reporting a finding writes ONLY pick_findings
--     (app/api/picking/findings/confirm|report — no orders write; the auto-CI it may raise writes
--     ci_returns, triggered since step 4, and only for an invoiced bill). A confirmed finding removes the
--     Billing Picking tab's checkbox; today's marker does not see it either. Recorded as the ORDER it
--     belongs to, so every screen that shows the bill (Floor, Billing) re-reads it.
--
-- WHAT COUNTS AS A CHANGE — exactly step 4's rule: INSERT / DELETE every row; UPDATE only rows whose
--   jsonb MINUS "updatedAt" differs. 🔴 mo_orders carries trg_mo_orders_updated_at (BEFORE UPDATE,
--   CORE §13: the DATABASE owns mo_orders."updatedAt"). It is NOT fought and NOT touched: it stamps
--   "updatedAt" on every UPDATE, including a no-op, and the AFTER trigger's diff removes "updatedAt"
--   before comparing — so a no-op or a stamp-only update writes NOTHING (proved by the TEST file).
--   pick_findings has no "updatedAt"; so_tags' is Prisma's @updatedAt — both handled the same way.
--
-- 🔴 FAILURE DIRECTION — the step-1/step-4 rule: the functions swallow their own failure
--   (RAISE WARNING, RETURN NULL). A broken change book never fails a mail order, a tag or a finding.
--   ⚠ THAT IS WHY THE CHECK IS WIDENED FIRST (part 1, before part 2): with the old CHECK, every
--   mail_order / so_tag line would fail the CHECK, be swallowed as a WARNING and silently vanish.
--
-- LOCKS
--   Part 1 is ONE ALTER TABLE (DROP + ADD CONSTRAINT): ACCESS EXCLUSIVE on live_changes while the new
--   CHECK validates every existing row. live_changes is small (pruned to 3 days; ~1-3k rows/day) so this
--   is milliseconds — but during it every trigger insert (i.e. every business write on the 24 already
--   triggered tables) WAITS for it; nothing fails. Run after hours.
--   Part 2: each CREATE TRIGGER takes a brief SHARE ROW EXCLUSIVE lock on its table (milliseconds);
--   no table is rewritten.
--
-- HOW TO RUN (Smart Flow, Supabase SQL Editor)
--   a. FIRST the READ-ONLY PRE-CHECK below, on its own (un-comment, run, re-comment).
--   b. Then this whole file ONCE, after hours. Re-runnable (DROP … IF EXISTS / DROP TRIGGER IF EXISTS).
--   c. The last statement is the verification (one UNION ALL result).
--   d. Then sql/2026-09-30-live-changes-billing-TEST.sql — success = ERROR "TEST OK — rolled back (…)".
--   Nothing READS the new entities until app_settings 'live.feed.billing' is switched on (it stays
--   absent = OFF in this step); Floor asks topics order,trip,config and never sees mail_order / so_tag.
--
-- KILL SWITCH (run on its own; instant; business writes carry on untouched)
--   ALTER TABLE mo_orders     DISABLE TRIGGER trg_live_changes_mo_orders_ins;
--   ALTER TABLE mo_orders     DISABLE TRIGGER trg_live_changes_mo_orders_upd;
--   ALTER TABLE mo_orders     DISABLE TRIGGER trg_live_changes_mo_orders_del;
--   ALTER TABLE so_tags       DISABLE TRIGGER trg_live_changes_so_tags_ins;
--   ALTER TABLE so_tags       DISABLE TRIGGER trg_live_changes_so_tags_upd;
--   ALTER TABLE so_tags       DISABLE TRIGGER trg_live_changes_so_tags_del;
--   ALTER TABLE pick_findings DISABLE TRIGGER trg_live_changes_pick_findings_ins;
--   ALTER TABLE pick_findings DISABLE TRIGGER trg_live_changes_pick_findings_upd;
--   ALTER TABLE pick_findings DISABLE TRIGGER trg_live_changes_pick_findings_del;
--   (⚠ never touch trg_mo_orders_updated_at — it is not part of the feed.)
--
-- FULL ROLLBACK (only the switched-off Billing path reads the new entities)
--   DROP TRIGGER IF EXISTS trg_live_changes_mo_orders_ins ON mo_orders;
--   DROP TRIGGER IF EXISTS trg_live_changes_mo_orders_upd ON mo_orders;
--   DROP TRIGGER IF EXISTS trg_live_changes_mo_orders_del ON mo_orders;
--   DROP TRIGGER IF EXISTS trg_live_changes_so_tags_ins ON so_tags;
--   DROP TRIGGER IF EXISTS trg_live_changes_so_tags_upd ON so_tags;
--   DROP TRIGGER IF EXISTS trg_live_changes_so_tags_del ON so_tags;
--   DROP TRIGGER IF EXISTS trg_live_changes_pick_findings_ins ON pick_findings;
--   DROP TRIGGER IF EXISTS trg_live_changes_pick_findings_upd ON pick_findings;
--   DROP TRIGGER IF EXISTS trg_live_changes_pick_findings_del ON pick_findings;
--   -- then, to narrow the CHECK back, the rows it would reject must go first (they are only change notes):
--   DELETE FROM live_changes WHERE entity IN ('mail_order', 'so_tag');
--   ALTER TABLE live_changes DROP CONSTRAINT IF EXISTS chk_live_changes_entity,
--     ADD CONSTRAINT chk_live_changes_entity CHECK (entity IN ('order', 'trip', 'config'));
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- READ-ONLY PRE-CHECK — run on its own FIRST (un-comment, run, re-comment). Expect:
--   · 3 'table' rows (mo_orders, pick_findings, so_tags)
--   · 3 'key column' rows (mo_orders.id, pick_findings.orderId, so_tags.id — all integer)
--   · 1 'entity check' row = CHECK ((entity = ANY (ARRAY['order'::text, 'trip'::text, 'config'::text])))
--   · 3 'generic function' rows (live_changes_child_del / _ins / _upd — step 4 applied)
--   · EXACTLY 1 'existing trigger' row: mo_orders · trg_mo_orders_updated_at · O
--     (anything else on these three tables → stop and report)
--   · 1 'live_changes rows' row (its size — the part-1 lock is proportional to it)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- SELECT 'table'::text AS chk, table_name::text AS detail
--   FROM information_schema.tables
--  WHERE table_schema = 'public' AND table_name IN ('mo_orders', 'so_tags', 'pick_findings')
-- UNION ALL
-- SELECT 'key column'::text, table_name::text || '.' || column_name::text || ' · ' || data_type::text
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND (
--        (table_name IN ('mo_orders', 'so_tags') AND column_name = 'id')
--     OR (table_name = 'pick_findings' AND column_name = 'orderId'))
-- UNION ALL
-- SELECT 'entity check'::text, pg_get_constraintdef(oid)::text
--   FROM pg_constraint WHERE conname = 'chk_live_changes_entity'
-- UNION ALL
-- SELECT 'generic function'::text, p.proname::text
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname IN ('live_changes_child_ins', 'live_changes_child_upd', 'live_changes_child_del')
-- UNION ALL
-- SELECT 'existing trigger'::text, (tgrelid::regclass)::text || ' · ' || tgname::text || ' · ' || tgenabled::text
--   FROM pg_trigger
--  WHERE NOT tgisinternal AND (tgrelid::regclass)::text IN ('mo_orders', 'so_tags', 'pick_findings')
-- UNION ALL
-- SELECT 'live_changes rows'::text, count(*)::text FROM live_changes;
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- 1. Widen the entity CHECK — FIRST (see the header: otherwise the new lines are swallowed).
ALTER TABLE live_changes
  DROP CONSTRAINT IF EXISTS chk_live_changes_entity,
  ADD CONSTRAINT chk_live_changes_entity CHECK (entity IN ('order', 'trip', 'config', 'mail_order', 'so_tag'));

-- 2. The triggers — statement-level AFTER, one per event per table, each with its transition table(s),
--    on step 4's generic functions (arguments: entity, 'self' | 'parent', key column).
-- mo_orders — the Billing Orders tab. trg_mo_orders_updated_at (BEFORE UPDATE) is left exactly as it is.
DROP TRIGGER IF EXISTS trg_live_changes_mo_orders_ins ON mo_orders;
CREATE TRIGGER trg_live_changes_mo_orders_ins AFTER INSERT ON mo_orders REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_ins('mail_order', 'self', 'id');
DROP TRIGGER IF EXISTS trg_live_changes_mo_orders_upd ON mo_orders;
CREATE TRIGGER trg_live_changes_mo_orders_upd AFTER UPDATE ON mo_orders REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_upd('mail_order', 'self', 'id');
DROP TRIGGER IF EXISTS trg_live_changes_mo_orders_del ON mo_orders;
CREATE TRIGGER trg_live_changes_mo_orders_del AFTER DELETE ON mo_orders REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_del('mail_order', 'self', 'id');

-- so_tags — the Telephonic tab.
DROP TRIGGER IF EXISTS trg_live_changes_so_tags_ins ON so_tags;
CREATE TRIGGER trg_live_changes_so_tags_ins AFTER INSERT ON so_tags REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_ins('so_tag', 'self', 'id');
DROP TRIGGER IF EXISTS trg_live_changes_so_tags_upd ON so_tags;
CREATE TRIGGER trg_live_changes_so_tags_upd AFTER UPDATE ON so_tags REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_upd('so_tag', 'self', 'id');
DROP TRIGGER IF EXISTS trg_live_changes_so_tags_del ON so_tags;
CREATE TRIGGER trg_live_changes_so_tags_del AFTER DELETE ON so_tags REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_del('so_tag', 'self', 'id');

-- pick_findings — a finding changes the bill it belongs to (entity 'order').
DROP TRIGGER IF EXISTS trg_live_changes_pick_findings_ins ON pick_findings;
CREATE TRIGGER trg_live_changes_pick_findings_ins AFTER INSERT ON pick_findings REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_ins('order', 'parent', 'orderId');
DROP TRIGGER IF EXISTS trg_live_changes_pick_findings_upd ON pick_findings;
CREATE TRIGGER trg_live_changes_pick_findings_upd AFTER UPDATE ON pick_findings REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_upd('order', 'parent', 'orderId');
DROP TRIGGER IF EXISTS trg_live_changes_pick_findings_del ON pick_findings;
CREATE TRIGGER trg_live_changes_pick_findings_del AFTER DELETE ON pick_findings REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_del('order', 'parent', 'orderId');

-- 3. Verification (read-only). The SQL Editor shows only the last result. Expect:
--    · 3 'triggers' rows (mo_orders, pick_findings, so_tags), each "del=O ins=O upd=O";
--    · 1 'entity check' row naming all five entities;
--    · 1 'all live_changes triggers' row = 81 (orders 3 + step 4 69 + these 9);
--    · 1 'mo_orders stamp trigger' row = trg_mo_orders_updated_at · O (untouched).
SELECT 'triggers'::text AS kind,
       (tgrelid::regclass)::text AS name,
       string_agg(regexp_replace(tgname::text, '^.*_(ins|upd|del)$', '\1') || '=' || tgenabled::text, ' '
                  ORDER BY tgname) AS detail
  FROM pg_trigger
 WHERE tgname LIKE 'trg_live_changes_%'
   AND (tgrelid::regclass)::text IN ('mo_orders', 'so_tags', 'pick_findings')
 GROUP BY tgrelid
UNION ALL
SELECT 'entity check'::text, 'chk_live_changes_entity'::text, pg_get_constraintdef(oid)::text
  FROM pg_constraint WHERE conname = 'chk_live_changes_entity'
UNION ALL
SELECT 'all live_changes triggers'::text, 'count'::text, count(*)::text
  FROM pg_trigger WHERE tgname LIKE 'trg_live_changes_%'
UNION ALL
SELECT 'mo_orders stamp trigger'::text, tgname::text, tgenabled::text
  FROM pg_trigger WHERE tgrelid = 'public.mo_orders'::regclass AND tgname = 'trg_mo_orders_updated_at'
ORDER BY 1, 2;
