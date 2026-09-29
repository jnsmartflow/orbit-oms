-- sql/2026-09-30-live-changes-step4.sql — LIVE FEED step 4: triggers on the remaining screen tables (Schema v27.46)
--
-- Design of record: docs/prompts/drafts/code-discovery-2026-09-29-live-change-feed.md §B.4, §C.2, §H, §M step 4
-- Record:           docs/prompts/drafts/code-update-2026-09-30-live-feed-step4.md
-- Builds on:        sql/2026-09-30-live-changes.sql (live_changes + the three `orders` triggers — applied, TEST OK)
-- Companion:        sql/2026-09-30-order-status-logs-cancelled-idx.sql (the Floor Cancelled-feed index,
--                   its own file because it locks order_status_logs against writes while it builds)
--
-- WHAT THIS DOES
--   Adds one helper and six trigger functions, and 69 statement-level AFTER triggers
--   (INSERT / UPDATE / DELETE on each of 23 tables), each writing narrow lines into live_changes.
--
--   ORDER-level child tables → entity 'order', entityId = the ORDER id:
--     pick_assignments (order_id — snake_case column) · tint_assignments ("orderId") ·
--     order_splits ("orderId") · import_obd_query_summary ("orderId", NULL skipped) ·
--     ci_returns ("orderId") · so_tag_matches ("orderId") ·
--     pick_delete_decisions ("orderIds" int[], "keptOrderIds" int[], "deletedOrderId" — arrays are
--       expanded to one line per id, NULLs skipped)
--   TRIP tables → entity 'trip', entityId = the TRIP id:
--     trips (id — its own row) · trip_drops ("tripId") · trip_activity ("tripId")
--   CONFIG tables → entity 'config', entityId = the TABLE NAME (a screen does one full reload):
--     delivery_point_master · area_master · route_master · delivery_type_master · dispatch_slot_master ·
--     vehicle_master · transporter_master · route_clubs · route_club_members · load_plan_config ·
--     app_settings · obd_visibility_rules · app_tag_settings
--
--   NOT triggered (deliberately): orders (step 1 already) · order_status_logs (owner decision — always
--   paired with an orders / tint write for anything a screen shows) · users and every other access table
--   (user_page_access, role_permissions, user_roles, attendance_settings — they carry the v27.44
--   access-version triggers instead) · system_config · live_changes · live_feed_meta.
--
-- WHAT COUNTS AS A CHANGE
--   INSERT / DELETE: every row. UPDATE: only rows whose jsonb, MINUS "updatedAt", differs before vs
--   after — computed key-free as (new EXCEPT old) ∪ (old EXCEPT new) over to_jsonb(row) - 'updatedAt',
--   so it works on tables whose key is not `id` (load_plan_config) and it also catches a row whose
--   parent key moved (both the old and the new parent are recorded). A no-op UPDATE writes nothing.
--   One INSERT … SELECT DISTINCT per STATEMENT: a bulk write stays one trigger call.
--   op = the source row's operation for a table's own entity (trips, config); 'U' when the line names
--   a PARENT (the parent changed, it was not inserted or deleted) — same as step 1's trip lines.
--
-- 🔴 FAILURE DIRECTION — same as step 1, deliberately the OPPOSITE of the access-version triggers:
--   every function wraps its work in EXCEPTION WHEN OTHERS → RAISE WARNING → RETURN NULL. A broken
--   change book must NEVER fail a business write. Do not "harmonise" with bump_access_version().
--
-- HOW TO RUN (Smart Flow, Supabase SQL Editor)
--   a. FIRST the READ-ONLY PRE-CHECK below, on its own (un-comment, run, re-comment).
--   b. Then this whole file ONCE, after hours, database healthy. Re-runnable (CREATE OR REPLACE,
--      DROP TRIGGER IF EXISTS). Creating a trigger takes a brief SHARE ROW EXCLUSIVE lock per table
--      (milliseconds each); no table is rewritten.
--   c. The last statement is the verification (one UNION ALL result).
--   d. Then sql/2026-09-30-live-changes-step4-TEST.sql — success = ERROR "TEST OK — rolled back (…)".
--
-- KILL SWITCH (run on its own; instant, no deploy — business writes carry on untouched)
--   Fastest, every step-4 trigger in one go (leaves the step-1 orders triggers alone):
--   DO $$ DECLARE r record; BEGIN
--     FOR r IN SELECT tgrelid::regclass AS t, tgname FROM pg_trigger
--               WHERE tgname LIKE 'trg_live_changes_%' AND tgrelid <> 'public.orders'::regclass LOOP
--       EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I', r.t, r.tgname);
--     END LOOP; END $$;
--   (ENABLE: the same block with ENABLE.) Or one trigger at a time:
--   ALTER TABLE pick_assignments DISABLE TRIGGER trg_live_changes_pick_assignments_ins;
--   ALTER TABLE pick_assignments DISABLE TRIGGER trg_live_changes_pick_assignments_upd;
--   ALTER TABLE pick_assignments DISABLE TRIGGER trg_live_changes_pick_assignments_del;
--   ALTER TABLE tint_assignments DISABLE TRIGGER trg_live_changes_tint_assignments_ins;
--   ALTER TABLE tint_assignments DISABLE TRIGGER trg_live_changes_tint_assignments_upd;
--   ALTER TABLE tint_assignments DISABLE TRIGGER trg_live_changes_tint_assignments_del;
--   ALTER TABLE order_splits DISABLE TRIGGER trg_live_changes_order_splits_ins;
--   ALTER TABLE order_splits DISABLE TRIGGER trg_live_changes_order_splits_upd;
--   ALTER TABLE order_splits DISABLE TRIGGER trg_live_changes_order_splits_del;
--   ALTER TABLE import_obd_query_summary DISABLE TRIGGER trg_live_changes_import_obd_query_summary_ins;
--   ALTER TABLE import_obd_query_summary DISABLE TRIGGER trg_live_changes_import_obd_query_summary_upd;
--   ALTER TABLE import_obd_query_summary DISABLE TRIGGER trg_live_changes_import_obd_query_summary_del;
--   ALTER TABLE ci_returns DISABLE TRIGGER trg_live_changes_ci_returns_ins;
--   ALTER TABLE ci_returns DISABLE TRIGGER trg_live_changes_ci_returns_upd;
--   ALTER TABLE ci_returns DISABLE TRIGGER trg_live_changes_ci_returns_del;
--   ALTER TABLE so_tag_matches DISABLE TRIGGER trg_live_changes_so_tag_matches_ins;
--   ALTER TABLE so_tag_matches DISABLE TRIGGER trg_live_changes_so_tag_matches_upd;
--   ALTER TABLE so_tag_matches DISABLE TRIGGER trg_live_changes_so_tag_matches_del;
--   ALTER TABLE pick_delete_decisions DISABLE TRIGGER trg_live_changes_pick_delete_decisions_ins;
--   ALTER TABLE pick_delete_decisions DISABLE TRIGGER trg_live_changes_pick_delete_decisions_upd;
--   ALTER TABLE pick_delete_decisions DISABLE TRIGGER trg_live_changes_pick_delete_decisions_del;
--   ALTER TABLE trips DISABLE TRIGGER trg_live_changes_trips_ins;
--   ALTER TABLE trips DISABLE TRIGGER trg_live_changes_trips_upd;
--   ALTER TABLE trips DISABLE TRIGGER trg_live_changes_trips_del;
--   ALTER TABLE trip_drops DISABLE TRIGGER trg_live_changes_trip_drops_ins;
--   ALTER TABLE trip_drops DISABLE TRIGGER trg_live_changes_trip_drops_upd;
--   ALTER TABLE trip_drops DISABLE TRIGGER trg_live_changes_trip_drops_del;
--   ALTER TABLE trip_activity DISABLE TRIGGER trg_live_changes_trip_activity_ins;
--   ALTER TABLE trip_activity DISABLE TRIGGER trg_live_changes_trip_activity_upd;
--   ALTER TABLE trip_activity DISABLE TRIGGER trg_live_changes_trip_activity_del;
--   ALTER TABLE delivery_point_master DISABLE TRIGGER trg_live_changes_delivery_point_master_ins;
--   ALTER TABLE delivery_point_master DISABLE TRIGGER trg_live_changes_delivery_point_master_upd;
--   ALTER TABLE delivery_point_master DISABLE TRIGGER trg_live_changes_delivery_point_master_del;
--   ALTER TABLE area_master DISABLE TRIGGER trg_live_changes_area_master_ins;
--   ALTER TABLE area_master DISABLE TRIGGER trg_live_changes_area_master_upd;
--   ALTER TABLE area_master DISABLE TRIGGER trg_live_changes_area_master_del;
--   ALTER TABLE route_master DISABLE TRIGGER trg_live_changes_route_master_ins;
--   ALTER TABLE route_master DISABLE TRIGGER trg_live_changes_route_master_upd;
--   ALTER TABLE route_master DISABLE TRIGGER trg_live_changes_route_master_del;
--   ALTER TABLE delivery_type_master DISABLE TRIGGER trg_live_changes_delivery_type_master_ins;
--   ALTER TABLE delivery_type_master DISABLE TRIGGER trg_live_changes_delivery_type_master_upd;
--   ALTER TABLE delivery_type_master DISABLE TRIGGER trg_live_changes_delivery_type_master_del;
--   ALTER TABLE dispatch_slot_master DISABLE TRIGGER trg_live_changes_dispatch_slot_master_ins;
--   ALTER TABLE dispatch_slot_master DISABLE TRIGGER trg_live_changes_dispatch_slot_master_upd;
--   ALTER TABLE dispatch_slot_master DISABLE TRIGGER trg_live_changes_dispatch_slot_master_del;
--   ALTER TABLE vehicle_master DISABLE TRIGGER trg_live_changes_vehicle_master_ins;
--   ALTER TABLE vehicle_master DISABLE TRIGGER trg_live_changes_vehicle_master_upd;
--   ALTER TABLE vehicle_master DISABLE TRIGGER trg_live_changes_vehicle_master_del;
--   ALTER TABLE transporter_master DISABLE TRIGGER trg_live_changes_transporter_master_ins;
--   ALTER TABLE transporter_master DISABLE TRIGGER trg_live_changes_transporter_master_upd;
--   ALTER TABLE transporter_master DISABLE TRIGGER trg_live_changes_transporter_master_del;
--   ALTER TABLE route_clubs DISABLE TRIGGER trg_live_changes_route_clubs_ins;
--   ALTER TABLE route_clubs DISABLE TRIGGER trg_live_changes_route_clubs_upd;
--   ALTER TABLE route_clubs DISABLE TRIGGER trg_live_changes_route_clubs_del;
--   ALTER TABLE route_club_members DISABLE TRIGGER trg_live_changes_route_club_members_ins;
--   ALTER TABLE route_club_members DISABLE TRIGGER trg_live_changes_route_club_members_upd;
--   ALTER TABLE route_club_members DISABLE TRIGGER trg_live_changes_route_club_members_del;
--   ALTER TABLE load_plan_config DISABLE TRIGGER trg_live_changes_load_plan_config_ins;
--   ALTER TABLE load_plan_config DISABLE TRIGGER trg_live_changes_load_plan_config_upd;
--   ALTER TABLE load_plan_config DISABLE TRIGGER trg_live_changes_load_plan_config_del;
--   ALTER TABLE app_settings DISABLE TRIGGER trg_live_changes_app_settings_ins;
--   ALTER TABLE app_settings DISABLE TRIGGER trg_live_changes_app_settings_upd;
--   ALTER TABLE app_settings DISABLE TRIGGER trg_live_changes_app_settings_del;
--   ALTER TABLE obd_visibility_rules DISABLE TRIGGER trg_live_changes_obd_visibility_rules_ins;
--   ALTER TABLE obd_visibility_rules DISABLE TRIGGER trg_live_changes_obd_visibility_rules_upd;
--   ALTER TABLE obd_visibility_rules DISABLE TRIGGER trg_live_changes_obd_visibility_rules_del;
--   ALTER TABLE app_tag_settings DISABLE TRIGGER trg_live_changes_app_tag_settings_ins;
--   ALTER TABLE app_tag_settings DISABLE TRIGGER trg_live_changes_app_tag_settings_upd;
--   ALTER TABLE app_tag_settings DISABLE TRIGGER trg_live_changes_app_tag_settings_del;
--
-- FULL ROLLBACK (only the switched-off API reads live_changes; removing these breaks nothing)
--   DROP TRIGGER IF EXISTS trg_live_changes_pick_assignments_ins ON pick_assignments;
--   DROP TRIGGER IF EXISTS trg_live_changes_pick_assignments_upd ON pick_assignments;
--   DROP TRIGGER IF EXISTS trg_live_changes_pick_assignments_del ON pick_assignments;
--   DROP TRIGGER IF EXISTS trg_live_changes_tint_assignments_ins ON tint_assignments;
--   DROP TRIGGER IF EXISTS trg_live_changes_tint_assignments_upd ON tint_assignments;
--   DROP TRIGGER IF EXISTS trg_live_changes_tint_assignments_del ON tint_assignments;
--   DROP TRIGGER IF EXISTS trg_live_changes_order_splits_ins ON order_splits;
--   DROP TRIGGER IF EXISTS trg_live_changes_order_splits_upd ON order_splits;
--   DROP TRIGGER IF EXISTS trg_live_changes_order_splits_del ON order_splits;
--   DROP TRIGGER IF EXISTS trg_live_changes_import_obd_query_summary_ins ON import_obd_query_summary;
--   DROP TRIGGER IF EXISTS trg_live_changes_import_obd_query_summary_upd ON import_obd_query_summary;
--   DROP TRIGGER IF EXISTS trg_live_changes_import_obd_query_summary_del ON import_obd_query_summary;
--   DROP TRIGGER IF EXISTS trg_live_changes_ci_returns_ins ON ci_returns;
--   DROP TRIGGER IF EXISTS trg_live_changes_ci_returns_upd ON ci_returns;
--   DROP TRIGGER IF EXISTS trg_live_changes_ci_returns_del ON ci_returns;
--   DROP TRIGGER IF EXISTS trg_live_changes_so_tag_matches_ins ON so_tag_matches;
--   DROP TRIGGER IF EXISTS trg_live_changes_so_tag_matches_upd ON so_tag_matches;
--   DROP TRIGGER IF EXISTS trg_live_changes_so_tag_matches_del ON so_tag_matches;
--   DROP TRIGGER IF EXISTS trg_live_changes_pick_delete_decisions_ins ON pick_delete_decisions;
--   DROP TRIGGER IF EXISTS trg_live_changes_pick_delete_decisions_upd ON pick_delete_decisions;
--   DROP TRIGGER IF EXISTS trg_live_changes_pick_delete_decisions_del ON pick_delete_decisions;
--   DROP TRIGGER IF EXISTS trg_live_changes_trips_ins ON trips;
--   DROP TRIGGER IF EXISTS trg_live_changes_trips_upd ON trips;
--   DROP TRIGGER IF EXISTS trg_live_changes_trips_del ON trips;
--   DROP TRIGGER IF EXISTS trg_live_changes_trip_drops_ins ON trip_drops;
--   DROP TRIGGER IF EXISTS trg_live_changes_trip_drops_upd ON trip_drops;
--   DROP TRIGGER IF EXISTS trg_live_changes_trip_drops_del ON trip_drops;
--   DROP TRIGGER IF EXISTS trg_live_changes_trip_activity_ins ON trip_activity;
--   DROP TRIGGER IF EXISTS trg_live_changes_trip_activity_upd ON trip_activity;
--   DROP TRIGGER IF EXISTS trg_live_changes_trip_activity_del ON trip_activity;
--   DROP TRIGGER IF EXISTS trg_live_changes_delivery_point_master_ins ON delivery_point_master;
--   DROP TRIGGER IF EXISTS trg_live_changes_delivery_point_master_upd ON delivery_point_master;
--   DROP TRIGGER IF EXISTS trg_live_changes_delivery_point_master_del ON delivery_point_master;
--   DROP TRIGGER IF EXISTS trg_live_changes_area_master_ins ON area_master;
--   DROP TRIGGER IF EXISTS trg_live_changes_area_master_upd ON area_master;
--   DROP TRIGGER IF EXISTS trg_live_changes_area_master_del ON area_master;
--   DROP TRIGGER IF EXISTS trg_live_changes_route_master_ins ON route_master;
--   DROP TRIGGER IF EXISTS trg_live_changes_route_master_upd ON route_master;
--   DROP TRIGGER IF EXISTS trg_live_changes_route_master_del ON route_master;
--   DROP TRIGGER IF EXISTS trg_live_changes_delivery_type_master_ins ON delivery_type_master;
--   DROP TRIGGER IF EXISTS trg_live_changes_delivery_type_master_upd ON delivery_type_master;
--   DROP TRIGGER IF EXISTS trg_live_changes_delivery_type_master_del ON delivery_type_master;
--   DROP TRIGGER IF EXISTS trg_live_changes_dispatch_slot_master_ins ON dispatch_slot_master;
--   DROP TRIGGER IF EXISTS trg_live_changes_dispatch_slot_master_upd ON dispatch_slot_master;
--   DROP TRIGGER IF EXISTS trg_live_changes_dispatch_slot_master_del ON dispatch_slot_master;
--   DROP TRIGGER IF EXISTS trg_live_changes_vehicle_master_ins ON vehicle_master;
--   DROP TRIGGER IF EXISTS trg_live_changes_vehicle_master_upd ON vehicle_master;
--   DROP TRIGGER IF EXISTS trg_live_changes_vehicle_master_del ON vehicle_master;
--   DROP TRIGGER IF EXISTS trg_live_changes_transporter_master_ins ON transporter_master;
--   DROP TRIGGER IF EXISTS trg_live_changes_transporter_master_upd ON transporter_master;
--   DROP TRIGGER IF EXISTS trg_live_changes_transporter_master_del ON transporter_master;
--   DROP TRIGGER IF EXISTS trg_live_changes_route_clubs_ins ON route_clubs;
--   DROP TRIGGER IF EXISTS trg_live_changes_route_clubs_upd ON route_clubs;
--   DROP TRIGGER IF EXISTS trg_live_changes_route_clubs_del ON route_clubs;
--   DROP TRIGGER IF EXISTS trg_live_changes_route_club_members_ins ON route_club_members;
--   DROP TRIGGER IF EXISTS trg_live_changes_route_club_members_upd ON route_club_members;
--   DROP TRIGGER IF EXISTS trg_live_changes_route_club_members_del ON route_club_members;
--   DROP TRIGGER IF EXISTS trg_live_changes_load_plan_config_ins ON load_plan_config;
--   DROP TRIGGER IF EXISTS trg_live_changes_load_plan_config_upd ON load_plan_config;
--   DROP TRIGGER IF EXISTS trg_live_changes_load_plan_config_del ON load_plan_config;
--   DROP TRIGGER IF EXISTS trg_live_changes_app_settings_ins ON app_settings;
--   DROP TRIGGER IF EXISTS trg_live_changes_app_settings_upd ON app_settings;
--   DROP TRIGGER IF EXISTS trg_live_changes_app_settings_del ON app_settings;
--   DROP TRIGGER IF EXISTS trg_live_changes_obd_visibility_rules_ins ON obd_visibility_rules;
--   DROP TRIGGER IF EXISTS trg_live_changes_obd_visibility_rules_upd ON obd_visibility_rules;
--   DROP TRIGGER IF EXISTS trg_live_changes_obd_visibility_rules_del ON obd_visibility_rules;
--   DROP TRIGGER IF EXISTS trg_live_changes_app_tag_settings_ins ON app_tag_settings;
--   DROP TRIGGER IF EXISTS trg_live_changes_app_tag_settings_upd ON app_tag_settings;
--   DROP TRIGGER IF EXISTS trg_live_changes_app_tag_settings_del ON app_tag_settings;
--   DROP FUNCTION IF EXISTS live_changes_child_ins();
--   DROP FUNCTION IF EXISTS live_changes_child_upd();
--   DROP FUNCTION IF EXISTS live_changes_child_del();
--   DROP FUNCTION IF EXISTS live_changes_config_ins();
--   DROP FUNCTION IF EXISTS live_changes_config_upd();
--   DROP FUNCTION IF EXISTS live_changes_config_del();
--   DROP FUNCTION IF EXISTS live_changes_keys(jsonb, text[]);
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- READ-ONLY PRE-CHECK — run on its own FIRST (un-comment, run, re-comment). Expect:
--   · 23 'table' rows (every table below exists in public)
--   · 12 'key column' rows (every parent-key column the triggers read)
--   · 1 'live_changes present' row (step 1 applied)
--   · NO 'existing trigger' rows (none of these 23 tables has a trigger today)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- SELECT 'table'::text AS chk, table_name::text AS detail
--   FROM information_schema.tables
--  WHERE table_schema = 'public' AND table_name IN (
--    'pick_assignments','tint_assignments','order_splits','import_obd_query_summary','ci_returns',
--    'so_tag_matches','pick_delete_decisions','trips','trip_drops','trip_activity',
--    'delivery_point_master','area_master','route_master','delivery_type_master','dispatch_slot_master',
--    'vehicle_master','transporter_master','route_clubs','route_club_members','load_plan_config',
--    'app_settings','obd_visibility_rules','app_tag_settings')
-- UNION ALL
-- SELECT 'key column'::text, table_name::text || '.' || column_name::text || ' · ' || data_type::text
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND (
--        (table_name = 'pick_assignments' AND column_name = 'order_id')
--     OR (table_name IN ('tint_assignments','order_splits','import_obd_query_summary','ci_returns','so_tag_matches')
--         AND column_name = 'orderId')
--     OR (table_name = 'pick_delete_decisions' AND column_name IN ('orderIds','keptOrderIds','deletedOrderId'))
--     OR (table_name = 'trips' AND column_name = 'id')
--     OR (table_name IN ('trip_drops','trip_activity') AND column_name = 'tripId'))
-- UNION ALL
-- SELECT 'live_changes present'::text, table_name::text FROM information_schema.tables
--  WHERE table_schema = 'public' AND table_name = 'live_changes'
-- UNION ALL
-- SELECT 'existing trigger (expect none)'::text, (tgrelid::regclass)::text || ' · ' || tgname::text
--   FROM pg_trigger
--  WHERE NOT tgisinternal AND (tgrelid::regclass)::text IN (
--    'pick_assignments','tint_assignments','order_splits','import_obd_query_summary','ci_returns',
--    'so_tag_matches','pick_delete_decisions','trips','trip_drops','trip_activity',
--    'delivery_point_master','area_master','route_master','delivery_type_master','dispatch_slot_master',
--    'vehicle_master','transporter_master','route_clubs','route_club_members','load_plan_config',
--    'app_settings','obd_visibility_rules','app_tag_settings');
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- 1. Helper: the parent ids named by the given keys of one row (as jsonb). A key holding an array
--    (pick_delete_decisions."orderIds") yields one id per element; a NULL / missing key yields none.
CREATE OR REPLACE FUNCTION live_changes_keys(j jsonb, keys text[]) RETURNS SETOF text
LANGUAGE sql IMMUTABLE AS $$
  SELECT e.v
    FROM unnest(keys) AS k(name)
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(j -> k.name) = 'array' THEN j -> k.name
           ELSE jsonb_build_array(j -> k.name) END
    ) AS e(v)
   WHERE e.v IS NOT NULL
$$;

-- 2. Child / trip tables. Trigger arguments: (entity, mode, key column, [more key columns …]).
--    mode 'self'   = the key IS this table's own entity id (trips) → op is the row's own I/U/D;
--    mode 'parent' = the key names a parent (an order, a trip)      → op 'U' (the parent changed).
--    PL/pgSQL compiles a trigger function separately for each table it is attached to, so one
--    function safely serves every table.
CREATE OR REPLACE FUNCTION live_changes_child_ins() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_entity text   := TG_ARGV[0];
  v_op     text   := CASE WHEN TG_ARGV[1] = 'self' THEN 'I' ELSE 'U' END;
  v_keys   text[] := TG_ARGV[2:TG_NARGS - 1];
  v_table  text   := TG_TABLE_NAME;
BEGIN
  BEGIN
    INSERT INTO live_changes (entity, "entityId", op, "sourceTable")
    SELECT DISTINCT v_entity, k.v, v_op, v_table
      FROM (SELECT to_jsonb(n) AS j FROM lc_new n) c
      CROSS JOIN LATERAL live_changes_keys(c.j, v_keys) AS k(v);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live_changes: % INSERT not recorded (% %) — the write itself succeeded', TG_TABLE_NAME, SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION live_changes_child_upd() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_entity text   := TG_ARGV[0];
  v_keys   text[] := TG_ARGV[2:TG_NARGS - 1];
  v_table  text   := TG_TABLE_NAME;
BEGIN
  BEGIN
    INSERT INTO live_changes (entity, "entityId", op, "sourceTable")
    SELECT DISTINCT v_entity, k.v, 'U', v_table
      FROM ( (SELECT to_jsonb(n) - 'updatedAt' AS j FROM lc_new n
              EXCEPT
              SELECT to_jsonb(o) - 'updatedAt' FROM lc_old o)
             UNION
             (SELECT to_jsonb(o) - 'updatedAt' FROM lc_old o
              EXCEPT
              SELECT to_jsonb(n) - 'updatedAt' FROM lc_new n) ) c
      CROSS JOIN LATERAL live_changes_keys(c.j, v_keys) AS k(v);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live_changes: % UPDATE not recorded (% %) — the write itself succeeded', TG_TABLE_NAME, SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION live_changes_child_del() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_entity text   := TG_ARGV[0];
  v_op     text   := CASE WHEN TG_ARGV[1] = 'self' THEN 'D' ELSE 'U' END;
  v_keys   text[] := TG_ARGV[2:TG_NARGS - 1];
  v_table  text   := TG_TABLE_NAME;
BEGIN
  BEGIN
    INSERT INTO live_changes (entity, "entityId", op, "sourceTable")
    SELECT DISTINCT v_entity, k.v, v_op, v_table
      FROM (SELECT to_jsonb(o) AS j FROM lc_old o) c
      CROSS JOIN LATERAL live_changes_keys(c.j, v_keys) AS k(v);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live_changes: % DELETE not recorded (% %) — the write itself succeeded', TG_TABLE_NAME, SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END
$$;

-- 3. Config tables: ONE line per statement that really changed something — entity 'config',
--    entityId = the table name. No arguments.
CREATE OR REPLACE FUNCTION live_changes_config_ins() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM lc_new) THEN
      INSERT INTO live_changes (entity, "entityId", op, "sourceTable")
      VALUES ('config', TG_TABLE_NAME, 'I', TG_TABLE_NAME);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live_changes: % INSERT not recorded (% %) — the write itself succeeded', TG_TABLE_NAME, SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION live_changes_config_upd() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    IF EXISTS (SELECT to_jsonb(n) - 'updatedAt' FROM lc_new n
               EXCEPT
               SELECT to_jsonb(o) - 'updatedAt' FROM lc_old o) THEN
      INSERT INTO live_changes (entity, "entityId", op, "sourceTable")
      VALUES ('config', TG_TABLE_NAME, 'U', TG_TABLE_NAME);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live_changes: % UPDATE not recorded (% %) — the write itself succeeded', TG_TABLE_NAME, SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION live_changes_config_del() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM lc_old) THEN
      INSERT INTO live_changes (entity, "entityId", op, "sourceTable")
      VALUES ('config', TG_TABLE_NAME, 'D', TG_TABLE_NAME);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live_changes: % DELETE not recorded (% %) — the write itself succeeded', TG_TABLE_NAME, SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END
$$;

-- 4. The triggers — statement-level AFTER, one per event per table, each with its transition table(s).
-- pick_assignments
DROP TRIGGER IF EXISTS trg_live_changes_pick_assignments_ins ON pick_assignments;
CREATE TRIGGER trg_live_changes_pick_assignments_ins AFTER INSERT ON pick_assignments REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_ins('order', 'parent', 'order_id');
DROP TRIGGER IF EXISTS trg_live_changes_pick_assignments_upd ON pick_assignments;
CREATE TRIGGER trg_live_changes_pick_assignments_upd AFTER UPDATE ON pick_assignments REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_upd('order', 'parent', 'order_id');
DROP TRIGGER IF EXISTS trg_live_changes_pick_assignments_del ON pick_assignments;
CREATE TRIGGER trg_live_changes_pick_assignments_del AFTER DELETE ON pick_assignments REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_del('order', 'parent', 'order_id');

-- tint_assignments
DROP TRIGGER IF EXISTS trg_live_changes_tint_assignments_ins ON tint_assignments;
CREATE TRIGGER trg_live_changes_tint_assignments_ins AFTER INSERT ON tint_assignments REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_ins('order', 'parent', 'orderId');
DROP TRIGGER IF EXISTS trg_live_changes_tint_assignments_upd ON tint_assignments;
CREATE TRIGGER trg_live_changes_tint_assignments_upd AFTER UPDATE ON tint_assignments REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_upd('order', 'parent', 'orderId');
DROP TRIGGER IF EXISTS trg_live_changes_tint_assignments_del ON tint_assignments;
CREATE TRIGGER trg_live_changes_tint_assignments_del AFTER DELETE ON tint_assignments REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_del('order', 'parent', 'orderId');

-- order_splits
DROP TRIGGER IF EXISTS trg_live_changes_order_splits_ins ON order_splits;
CREATE TRIGGER trg_live_changes_order_splits_ins AFTER INSERT ON order_splits REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_ins('order', 'parent', 'orderId');
DROP TRIGGER IF EXISTS trg_live_changes_order_splits_upd ON order_splits;
CREATE TRIGGER trg_live_changes_order_splits_upd AFTER UPDATE ON order_splits REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_upd('order', 'parent', 'orderId');
DROP TRIGGER IF EXISTS trg_live_changes_order_splits_del ON order_splits;
CREATE TRIGGER trg_live_changes_order_splits_del AFTER DELETE ON order_splits REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_del('order', 'parent', 'orderId');

-- import_obd_query_summary
DROP TRIGGER IF EXISTS trg_live_changes_import_obd_query_summary_ins ON import_obd_query_summary;
CREATE TRIGGER trg_live_changes_import_obd_query_summary_ins AFTER INSERT ON import_obd_query_summary REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_ins('order', 'parent', 'orderId');
DROP TRIGGER IF EXISTS trg_live_changes_import_obd_query_summary_upd ON import_obd_query_summary;
CREATE TRIGGER trg_live_changes_import_obd_query_summary_upd AFTER UPDATE ON import_obd_query_summary REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_upd('order', 'parent', 'orderId');
DROP TRIGGER IF EXISTS trg_live_changes_import_obd_query_summary_del ON import_obd_query_summary;
CREATE TRIGGER trg_live_changes_import_obd_query_summary_del AFTER DELETE ON import_obd_query_summary REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_del('order', 'parent', 'orderId');

-- ci_returns
DROP TRIGGER IF EXISTS trg_live_changes_ci_returns_ins ON ci_returns;
CREATE TRIGGER trg_live_changes_ci_returns_ins AFTER INSERT ON ci_returns REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_ins('order', 'parent', 'orderId');
DROP TRIGGER IF EXISTS trg_live_changes_ci_returns_upd ON ci_returns;
CREATE TRIGGER trg_live_changes_ci_returns_upd AFTER UPDATE ON ci_returns REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_upd('order', 'parent', 'orderId');
DROP TRIGGER IF EXISTS trg_live_changes_ci_returns_del ON ci_returns;
CREATE TRIGGER trg_live_changes_ci_returns_del AFTER DELETE ON ci_returns REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_del('order', 'parent', 'orderId');

-- so_tag_matches
DROP TRIGGER IF EXISTS trg_live_changes_so_tag_matches_ins ON so_tag_matches;
CREATE TRIGGER trg_live_changes_so_tag_matches_ins AFTER INSERT ON so_tag_matches REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_ins('order', 'parent', 'orderId');
DROP TRIGGER IF EXISTS trg_live_changes_so_tag_matches_upd ON so_tag_matches;
CREATE TRIGGER trg_live_changes_so_tag_matches_upd AFTER UPDATE ON so_tag_matches REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_upd('order', 'parent', 'orderId');
DROP TRIGGER IF EXISTS trg_live_changes_so_tag_matches_del ON so_tag_matches;
CREATE TRIGGER trg_live_changes_so_tag_matches_del AFTER DELETE ON so_tag_matches REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_del('order', 'parent', 'orderId');

-- pick_delete_decisions
DROP TRIGGER IF EXISTS trg_live_changes_pick_delete_decisions_ins ON pick_delete_decisions;
CREATE TRIGGER trg_live_changes_pick_delete_decisions_ins AFTER INSERT ON pick_delete_decisions REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_ins('order', 'parent', 'orderIds', 'keptOrderIds', 'deletedOrderId');
DROP TRIGGER IF EXISTS trg_live_changes_pick_delete_decisions_upd ON pick_delete_decisions;
CREATE TRIGGER trg_live_changes_pick_delete_decisions_upd AFTER UPDATE ON pick_delete_decisions REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_upd('order', 'parent', 'orderIds', 'keptOrderIds', 'deletedOrderId');
DROP TRIGGER IF EXISTS trg_live_changes_pick_delete_decisions_del ON pick_delete_decisions;
CREATE TRIGGER trg_live_changes_pick_delete_decisions_del AFTER DELETE ON pick_delete_decisions REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_del('order', 'parent', 'orderIds', 'keptOrderIds', 'deletedOrderId');

-- trips
DROP TRIGGER IF EXISTS trg_live_changes_trips_ins ON trips;
CREATE TRIGGER trg_live_changes_trips_ins AFTER INSERT ON trips REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_ins('trip', 'self', 'id');
DROP TRIGGER IF EXISTS trg_live_changes_trips_upd ON trips;
CREATE TRIGGER trg_live_changes_trips_upd AFTER UPDATE ON trips REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_upd('trip', 'self', 'id');
DROP TRIGGER IF EXISTS trg_live_changes_trips_del ON trips;
CREATE TRIGGER trg_live_changes_trips_del AFTER DELETE ON trips REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_del('trip', 'self', 'id');

-- trip_drops
DROP TRIGGER IF EXISTS trg_live_changes_trip_drops_ins ON trip_drops;
CREATE TRIGGER trg_live_changes_trip_drops_ins AFTER INSERT ON trip_drops REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_ins('trip', 'parent', 'tripId');
DROP TRIGGER IF EXISTS trg_live_changes_trip_drops_upd ON trip_drops;
CREATE TRIGGER trg_live_changes_trip_drops_upd AFTER UPDATE ON trip_drops REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_upd('trip', 'parent', 'tripId');
DROP TRIGGER IF EXISTS trg_live_changes_trip_drops_del ON trip_drops;
CREATE TRIGGER trg_live_changes_trip_drops_del AFTER DELETE ON trip_drops REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_del('trip', 'parent', 'tripId');

-- trip_activity
DROP TRIGGER IF EXISTS trg_live_changes_trip_activity_ins ON trip_activity;
CREATE TRIGGER trg_live_changes_trip_activity_ins AFTER INSERT ON trip_activity REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_ins('trip', 'parent', 'tripId');
DROP TRIGGER IF EXISTS trg_live_changes_trip_activity_upd ON trip_activity;
CREATE TRIGGER trg_live_changes_trip_activity_upd AFTER UPDATE ON trip_activity REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_upd('trip', 'parent', 'tripId');
DROP TRIGGER IF EXISTS trg_live_changes_trip_activity_del ON trip_activity;
CREATE TRIGGER trg_live_changes_trip_activity_del AFTER DELETE ON trip_activity REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_child_del('trip', 'parent', 'tripId');

-- delivery_point_master
DROP TRIGGER IF EXISTS trg_live_changes_delivery_point_master_ins ON delivery_point_master;
CREATE TRIGGER trg_live_changes_delivery_point_master_ins AFTER INSERT ON delivery_point_master REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_ins();
DROP TRIGGER IF EXISTS trg_live_changes_delivery_point_master_upd ON delivery_point_master;
CREATE TRIGGER trg_live_changes_delivery_point_master_upd AFTER UPDATE ON delivery_point_master REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_upd();
DROP TRIGGER IF EXISTS trg_live_changes_delivery_point_master_del ON delivery_point_master;
CREATE TRIGGER trg_live_changes_delivery_point_master_del AFTER DELETE ON delivery_point_master REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_del();

-- area_master
DROP TRIGGER IF EXISTS trg_live_changes_area_master_ins ON area_master;
CREATE TRIGGER trg_live_changes_area_master_ins AFTER INSERT ON area_master REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_ins();
DROP TRIGGER IF EXISTS trg_live_changes_area_master_upd ON area_master;
CREATE TRIGGER trg_live_changes_area_master_upd AFTER UPDATE ON area_master REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_upd();
DROP TRIGGER IF EXISTS trg_live_changes_area_master_del ON area_master;
CREATE TRIGGER trg_live_changes_area_master_del AFTER DELETE ON area_master REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_del();

-- route_master
DROP TRIGGER IF EXISTS trg_live_changes_route_master_ins ON route_master;
CREATE TRIGGER trg_live_changes_route_master_ins AFTER INSERT ON route_master REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_ins();
DROP TRIGGER IF EXISTS trg_live_changes_route_master_upd ON route_master;
CREATE TRIGGER trg_live_changes_route_master_upd AFTER UPDATE ON route_master REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_upd();
DROP TRIGGER IF EXISTS trg_live_changes_route_master_del ON route_master;
CREATE TRIGGER trg_live_changes_route_master_del AFTER DELETE ON route_master REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_del();

-- delivery_type_master
DROP TRIGGER IF EXISTS trg_live_changes_delivery_type_master_ins ON delivery_type_master;
CREATE TRIGGER trg_live_changes_delivery_type_master_ins AFTER INSERT ON delivery_type_master REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_ins();
DROP TRIGGER IF EXISTS trg_live_changes_delivery_type_master_upd ON delivery_type_master;
CREATE TRIGGER trg_live_changes_delivery_type_master_upd AFTER UPDATE ON delivery_type_master REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_upd();
DROP TRIGGER IF EXISTS trg_live_changes_delivery_type_master_del ON delivery_type_master;
CREATE TRIGGER trg_live_changes_delivery_type_master_del AFTER DELETE ON delivery_type_master REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_del();

-- dispatch_slot_master
DROP TRIGGER IF EXISTS trg_live_changes_dispatch_slot_master_ins ON dispatch_slot_master;
CREATE TRIGGER trg_live_changes_dispatch_slot_master_ins AFTER INSERT ON dispatch_slot_master REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_ins();
DROP TRIGGER IF EXISTS trg_live_changes_dispatch_slot_master_upd ON dispatch_slot_master;
CREATE TRIGGER trg_live_changes_dispatch_slot_master_upd AFTER UPDATE ON dispatch_slot_master REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_upd();
DROP TRIGGER IF EXISTS trg_live_changes_dispatch_slot_master_del ON dispatch_slot_master;
CREATE TRIGGER trg_live_changes_dispatch_slot_master_del AFTER DELETE ON dispatch_slot_master REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_del();

-- vehicle_master
DROP TRIGGER IF EXISTS trg_live_changes_vehicle_master_ins ON vehicle_master;
CREATE TRIGGER trg_live_changes_vehicle_master_ins AFTER INSERT ON vehicle_master REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_ins();
DROP TRIGGER IF EXISTS trg_live_changes_vehicle_master_upd ON vehicle_master;
CREATE TRIGGER trg_live_changes_vehicle_master_upd AFTER UPDATE ON vehicle_master REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_upd();
DROP TRIGGER IF EXISTS trg_live_changes_vehicle_master_del ON vehicle_master;
CREATE TRIGGER trg_live_changes_vehicle_master_del AFTER DELETE ON vehicle_master REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_del();

-- transporter_master
DROP TRIGGER IF EXISTS trg_live_changes_transporter_master_ins ON transporter_master;
CREATE TRIGGER trg_live_changes_transporter_master_ins AFTER INSERT ON transporter_master REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_ins();
DROP TRIGGER IF EXISTS trg_live_changes_transporter_master_upd ON transporter_master;
CREATE TRIGGER trg_live_changes_transporter_master_upd AFTER UPDATE ON transporter_master REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_upd();
DROP TRIGGER IF EXISTS trg_live_changes_transporter_master_del ON transporter_master;
CREATE TRIGGER trg_live_changes_transporter_master_del AFTER DELETE ON transporter_master REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_del();

-- route_clubs
DROP TRIGGER IF EXISTS trg_live_changes_route_clubs_ins ON route_clubs;
CREATE TRIGGER trg_live_changes_route_clubs_ins AFTER INSERT ON route_clubs REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_ins();
DROP TRIGGER IF EXISTS trg_live_changes_route_clubs_upd ON route_clubs;
CREATE TRIGGER trg_live_changes_route_clubs_upd AFTER UPDATE ON route_clubs REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_upd();
DROP TRIGGER IF EXISTS trg_live_changes_route_clubs_del ON route_clubs;
CREATE TRIGGER trg_live_changes_route_clubs_del AFTER DELETE ON route_clubs REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_del();

-- route_club_members
DROP TRIGGER IF EXISTS trg_live_changes_route_club_members_ins ON route_club_members;
CREATE TRIGGER trg_live_changes_route_club_members_ins AFTER INSERT ON route_club_members REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_ins();
DROP TRIGGER IF EXISTS trg_live_changes_route_club_members_upd ON route_club_members;
CREATE TRIGGER trg_live_changes_route_club_members_upd AFTER UPDATE ON route_club_members REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_upd();
DROP TRIGGER IF EXISTS trg_live_changes_route_club_members_del ON route_club_members;
CREATE TRIGGER trg_live_changes_route_club_members_del AFTER DELETE ON route_club_members REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_del();

-- load_plan_config
DROP TRIGGER IF EXISTS trg_live_changes_load_plan_config_ins ON load_plan_config;
CREATE TRIGGER trg_live_changes_load_plan_config_ins AFTER INSERT ON load_plan_config REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_ins();
DROP TRIGGER IF EXISTS trg_live_changes_load_plan_config_upd ON load_plan_config;
CREATE TRIGGER trg_live_changes_load_plan_config_upd AFTER UPDATE ON load_plan_config REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_upd();
DROP TRIGGER IF EXISTS trg_live_changes_load_plan_config_del ON load_plan_config;
CREATE TRIGGER trg_live_changes_load_plan_config_del AFTER DELETE ON load_plan_config REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_del();

-- app_settings
DROP TRIGGER IF EXISTS trg_live_changes_app_settings_ins ON app_settings;
CREATE TRIGGER trg_live_changes_app_settings_ins AFTER INSERT ON app_settings REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_ins();
DROP TRIGGER IF EXISTS trg_live_changes_app_settings_upd ON app_settings;
CREATE TRIGGER trg_live_changes_app_settings_upd AFTER UPDATE ON app_settings REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_upd();
DROP TRIGGER IF EXISTS trg_live_changes_app_settings_del ON app_settings;
CREATE TRIGGER trg_live_changes_app_settings_del AFTER DELETE ON app_settings REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_del();

-- obd_visibility_rules
DROP TRIGGER IF EXISTS trg_live_changes_obd_visibility_rules_ins ON obd_visibility_rules;
CREATE TRIGGER trg_live_changes_obd_visibility_rules_ins AFTER INSERT ON obd_visibility_rules REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_ins();
DROP TRIGGER IF EXISTS trg_live_changes_obd_visibility_rules_upd ON obd_visibility_rules;
CREATE TRIGGER trg_live_changes_obd_visibility_rules_upd AFTER UPDATE ON obd_visibility_rules REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_upd();
DROP TRIGGER IF EXISTS trg_live_changes_obd_visibility_rules_del ON obd_visibility_rules;
CREATE TRIGGER trg_live_changes_obd_visibility_rules_del AFTER DELETE ON obd_visibility_rules REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_del();

-- app_tag_settings
DROP TRIGGER IF EXISTS trg_live_changes_app_tag_settings_ins ON app_tag_settings;
CREATE TRIGGER trg_live_changes_app_tag_settings_ins AFTER INSERT ON app_tag_settings REFERENCING NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_ins();
DROP TRIGGER IF EXISTS trg_live_changes_app_tag_settings_upd ON app_tag_settings;
CREATE TRIGGER trg_live_changes_app_tag_settings_upd AFTER UPDATE ON app_tag_settings REFERENCING OLD TABLE AS lc_old NEW TABLE AS lc_new
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_upd();
DROP TRIGGER IF EXISTS trg_live_changes_app_tag_settings_del ON app_tag_settings;
CREATE TRIGGER trg_live_changes_app_tag_settings_del AFTER DELETE ON app_tag_settings REFERENCING OLD TABLE AS lc_old
  FOR EACH STATEMENT EXECUTE FUNCTION live_changes_config_del();

-- 5. Verification (read-only). The SQL Editor shows only the last result. Expect 23 'triggers' rows,
--    one per table, each reading "del=O ins=O upd=O", one 'total' row = 69, and 7 'function' rows.
SELECT 'triggers'::text AS kind,
       (tgrelid::regclass)::text AS name,
       string_agg(regexp_replace(tgname::text, '^.*_(ins|upd|del)$', '\1') || '=' || tgenabled::text, ' '
                  ORDER BY tgname) AS detail
  FROM pg_trigger
 WHERE tgname LIKE 'trg_live_changes_%' AND tgrelid <> 'public.orders'::regclass
 GROUP BY tgrelid
UNION ALL
SELECT 'total'::text, 'step-4 triggers'::text, count(*)::text
  FROM pg_trigger
 WHERE tgname LIKE 'trg_live_changes_%' AND tgrelid <> 'public.orders'::regclass
UNION ALL
SELECT 'function'::text, p.proname::text, pg_get_function_identity_arguments(p.oid)::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('live_changes_keys','live_changes_child_ins','live_changes_child_upd','live_changes_child_del',
                     'live_changes_config_ins','live_changes_config_upd','live_changes_config_del')
ORDER BY 1, 2;
