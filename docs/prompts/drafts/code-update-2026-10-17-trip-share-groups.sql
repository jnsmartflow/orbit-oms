-- ═══════════════════════════════════════════════════════════════════════════
-- docs/prompts/drafts/code-update-2026-10-17-trip-share-groups.sql
-- Trip Sheets — per-group WhatsApp share chips: DATABASE STEP (step 2 of 3)
--
-- PROPOSED SCHEMA VERSION: v27.71 (CORE v146 header reads Schema v27.70).
--   Not minted here — step 3 mints the CORE entry in the same commit as the
--   code and the hand-edited prisma/schema.prisma.
--
-- RUN STATUS: RUN LIVE 2026-10-17 by Smart Flow; PART 4 read back 9 city1 ·
--   2 city2 · 7 project · 6 upc · 1 city_both · 19/21/36 null · trip_share_log
--   6 columns · 6 constraints + index · 3 triggers enabled. Minted as Schema
--   v27.71 in docs/CLAUDE_CORE.md v147. Do not re-run (it is safe if you do).
--   Was: the whole file in ONE paste. Re-runnable (IF NOT EXISTS,
--   guarded constraint adds, DROP TRIGGER IF EXISTS, idempotent UPDATEs).
--   No BEGIN/COMMIT. The last statement is the read-back.
--
-- WHAT
--   1. sales_officer_master."shareGroup" text NULL + chk_sales_officer_master_share_group
--      ('city1','city2','upc','project','city_both'); NULL = not mapped → "Other".
--   2. Fill it by id (owner list, confirmed 2026-10-17).
--   3. New table trip_share_log — one row per share of one group's sheet.
--   4. Read-back.
--
-- LIVE FEED (CORE §13: every table a screen reads needs a live_changes trigger)
--   sales_officer_master already carries trg_live_changes_sales_officer_master_*
--   (v27.64, live_changes_config_*) — the UPDATEs in PART 2 record ONE config
--   line per statement, so open screens do one throttled reload. Nothing new here.
--   trip_share_log gets the TRIP-CHILD shape used by trip_drops / trip_redeliveries
--   (sql/2026-09-30-live-changes-step4.sql, sql/2026-10-03-trip-redelivery.sql):
--   live_changes_child_{ins,upd,del}('trip', 'parent', 'tripId') — EXISTING
--   functions, none created or replaced; entity 'trip' is already admitted.
--   ⚠ /trip-sheets does not subscribe to the feed today (plain fetch); the
--   trigger is there so the chip ticks can go live in step 3 and so §13 holds.
--
-- RLS / GRANTS: none — consistent with the recent comparable tables
--   (trip_redeliveries: "the trips / trip_drops DDL issued no GRANT, REVOKE or
--   ENABLE ROW LEVEL SECURITY"; order_invoices: "RLS left at the Postgres
--   default (off)"). Access is enforced in the API (page key trip_sheet).
--
-- ID TYPES (prisma/schema.prisma): trips.id Int, users.id Int → integer FKs.
--
-- KILL SWITCH (run on its own):
--   ALTER TABLE trip_share_log DISABLE TRIGGER trg_live_changes_trip_share_log_ins;
--   ALTER TABLE trip_share_log DISABLE TRIGGER trg_live_changes_trip_share_log_upd;
--   ALTER TABLE trip_share_log DISABLE TRIGGER trg_live_changes_trip_share_log_del;
-- ═══════════════════════════════════════════════════════════════════════════


-- ── PART 1. sales_officer_master."shareGroup" ──────────────────────────────
ALTER TABLE sales_officer_master ADD COLUMN IF NOT EXISTS "shareGroup" text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_sales_officer_master_share_group'
       AND conrelid = 'sales_officer_master'::regclass
  ) THEN
    ALTER TABLE sales_officer_master
      ADD CONSTRAINT chk_sales_officer_master_share_group
      CHECK ("shareGroup" IS NULL OR "shareGroup" IN ('city1', 'city2', 'upc', 'project', 'city_both'));
  END IF;
END $$;


-- ── PART 2. Fill it — by id, owner list 2026-10-17 ─────────────────────────
-- Re-checked against the owner's list by NAME (the read-back below prints
-- every row's name beside its group — eyeball it once):

-- city1
UPDATE sales_officer_master SET "shareGroup" = 'city1'
 WHERE id IN (
   10,  -- Shiv Pal
   11,  -- Ravi Patel
   22,  -- Roopesh
   23,  -- Sunil
   24,  -- Pravesh
   31,  -- Zubin
   33,  -- Aman
   34,  -- Bhaven
   35   -- Divanshu
 ) AND "shareGroup" IS DISTINCT FROM 'city1';

-- city2
UPDATE sales_officer_master SET "shareGroup" = 'city2'
 WHERE id IN (
   12,  -- Rahul Pal
   26   -- Nirav
 ) AND "shareGroup" IS DISTINCT FROM 'city2';

-- project
UPDATE sales_officer_master SET "shareGroup" = 'project'
 WHERE id IN (
   9,   -- Ajay
   13,  -- Ravi Dedania
   14,  -- Lakhan
   15,  -- Tejas
   16,  -- Vishal
   17,  -- Narendra
   20   -- Pushpendra
 ) AND "shareGroup" IS DISTINCT FROM 'project';

-- upc
UPDATE sales_officer_master SET "shareGroup" = 'upc'
 WHERE id IN (
   18,  -- Abhishek
   25,  -- Vijendra
   27,  -- Bharat
   29,  -- Karan
   30,  -- Chirag
   32   -- Anand
 ) AND "shareGroup" IS DISTINCT FROM 'upc';

-- city_both
UPDATE sales_officer_master SET "shareGroup" = 'city_both'
 WHERE id IN (
   28   -- Kundan
 ) AND "shareGroup" IS DISTINCT FROM 'city_both';

-- Left NULL on purpose (not touched): 19 (TEST), 21 (blank name), 36 Neev.


-- ── PART 3. trip_share_log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trip_share_log (
  id           serial      NOT NULL,
  "tripId"     integer     NOT NULL,
  "groupKey"   text        NOT NULL,
  "sharedAt"   timestamptz NOT NULL DEFAULT now(),
  "sharedById" integer     NULL,
  "orderIds"   integer[]   NOT NULL,
  CONSTRAINT trip_share_log_pkey PRIMARY KEY (id),
  CONSTRAINT "trip_share_log_tripId_fkey"
    FOREIGN KEY ("tripId") REFERENCES trips(id) ON DELETE CASCADE,
  CONSTRAINT "trip_share_log_sharedById_fkey"
    FOREIGN KEY ("sharedById") REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_trip_share_log_group
    CHECK ("groupKey" IN ('city1', 'city2', 'upc', 'project', 'other'))
);

CREATE INDEX IF NOT EXISTS "trip_share_log_tripId_groupKey_idx"
  ON trip_share_log ("tripId", "groupKey");

COMMENT ON TABLE trip_share_log IS
  'Trip Sheets per-group WhatsApp share log (proposed Schema v27.71). One row per share; orderIds = the group''s bills at share time, so a tick can be shown as stale when the group changes. Written only by /api/trip-sheets.';

-- Live feed — trip-child shape, existing functions.
DROP TRIGGER IF EXISTS trg_live_changes_trip_share_log_ins ON trip_share_log;
CREATE TRIGGER trg_live_changes_trip_share_log_ins AFTER INSERT ON trip_share_log REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_ins('trip', 'parent', 'tripId');
DROP TRIGGER IF EXISTS trg_live_changes_trip_share_log_upd ON trip_share_log;
CREATE TRIGGER trg_live_changes_trip_share_log_upd AFTER UPDATE ON trip_share_log REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_upd('trip', 'parent', 'tripId');
DROP TRIGGER IF EXISTS trg_live_changes_trip_share_log_del ON trip_share_log;
CREATE TRIGGER trg_live_changes_trip_share_log_del AFTER DELETE ON trip_share_log REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_del('trip', 'parent', 'tripId');


-- ── PART 4. Read-back (read-only, last statement) ──────────────────────────
SELECT * FROM (
  SELECT '1 sales_officer_master'::text AS section,
         s.id::text                     AS id,
         s.name::text                   AS name,
         COALESCE(s."shareGroup", '(null)')::text AS detail,
         lpad(s.id::text, 6, '0')       AS sort_key
    FROM sales_officer_master s
  UNION ALL
  SELECT '2 trip_share_log table'::text,
         NULL::text,
         c.relname::text,
         ('columns: ' || (SELECT count(*) FROM information_schema.columns
                           WHERE table_schema = 'public' AND table_name = 'trip_share_log')::text
          || ' · rows: ' || (SELECT count(*) FROM trip_share_log)::text)::text,
         '000000'::text
    FROM pg_class c
   WHERE c.relname = 'trip_share_log' AND c.relkind = 'r'
  UNION ALL
  SELECT '3 new constraints + index'::text,
         count(*)::text,
         'expect 6'::text,
         string_agg(x.n::text, ', ' ORDER BY x.n::text)::text,
         '000000'::text
    FROM (
      SELECT con.conname::text AS n FROM pg_constraint con
       WHERE con.conname IN ('chk_sales_officer_master_share_group', 'trip_share_log_pkey',
                             'trip_share_log_tripId_fkey', 'trip_share_log_sharedById_fkey',
                             'chk_trip_share_log_group')
      UNION ALL
      SELECT i.indexname::text FROM pg_indexes i
       WHERE i.schemaname = 'public' AND i.indexname = 'trip_share_log_tripId_groupKey_idx'
    ) x
  UNION ALL
  SELECT '4 trip_share_log triggers'::text,
         count(*)::text,
         'expect 3'::text,
         string_agg(t.tgname::text || ' → ' || p.proname::text || ' (' || t.tgenabled::text || ')', ', '
                    ORDER BY t.tgname::text)::text,
         '000000'::text
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = 'trip_share_log'::regclass AND NOT t.tgisinternal
) r
ORDER BY r.section, r.sort_key;
