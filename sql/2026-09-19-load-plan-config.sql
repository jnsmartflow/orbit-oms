-- ============================================================================
-- 2026-09-19 · Floor · LOAD PLAN — the config table, seeded for Upcountry
--
-- The Upcountry tab's "Load plan" view suggests truckloads from the pool
-- (lib/trips/load-plan.ts). Its RULES live here, one row per delivery type,
-- so they change without a deploy:
--
--   smallMaxKg    a Small truck's limit (2,000)
--   bigMaxKg      a Big truck's limit (3,000) — also the Bulk threshold for a
--                 single stop
--   mainRouteIds  routes whose leftover truck partners may join
--   partners      [{ routeId, joins: [routeIds in priority order],
--                    pick: "most_space" | "in_order" }]
--
-- ROUTE IDS, NEVER NAMES — looked up BY NAME below, so no id is hard-coded:
--   main      Navsari, Vapi, Bharuch
--   partners  Chikhli → Vapi or Navsari, whichever has MORE free space (a tie
--             goes to list order: Vapi first)
--             Vansda  → Navsari first, then Vapi
--             Bardoli → Navsari
--             Kamrej  → Bharuch
--
-- A missing or malformed row is not an error: the view reads "Load plan not
-- set up" (lib/trips/load-plan.ts parseLoadPlanConfig). The app also survives
-- this table not existing yet — run this before or after the deploy.
--
-- ONE SCRIPT, ALL OR NOTHING. Paste the whole file and run it once.
-- 🔴 NO BEGIN/COMMIT — THE DO BLOCK IS THE TRANSACTION (house rule for the
-- Supabase SQL Editor). A DO block is one statement: any RAISE inside it undoes
-- the CREATE TABLE and the INSERT together. A route or delivery-type name that
-- does not match exactly one row stops the whole script.
-- ⚠ A SECOND RUN FAILS (the table exists) and changes nothing.
--
-- The SELECT at the end is READ-ONLY and is the result the editor shows.
-- ============================================================================

DO $$
DECLARE
  v_type    integer;
  v_n       integer;
  v_ids     jsonb := '{}'::jsonb;
  r         record;
BEGIN
  -- ── Every name, checked before anything is created ────────────────────────
  SELECT count(*) INTO v_n FROM delivery_type_master WHERE name = 'Upcountry';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Delivery type "Upcountry" matches % rows, expected exactly 1 — nothing created', v_n;
  END IF;
  SELECT id INTO v_type FROM delivery_type_master WHERE name = 'Upcountry';

  FOR r IN SELECT unnest(ARRAY['Navsari','Vapi','Bharuch','Chikhli','Vansda','Bardoli','Kamrej']) AS route_name LOOP
    SELECT count(*) INTO v_n FROM route_master WHERE name = r.route_name;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'Route "%" matches % rows, expected exactly 1 — nothing created', r.route_name, v_n;
    END IF;
    v_ids := v_ids || jsonb_build_object(r.route_name, (SELECT id FROM route_master WHERE name = r.route_name));
  END LOOP;

  -- ── The table ─────────────────────────────────────────────────────────────
  CREATE TABLE load_plan_config (
    "deliveryTypeId" integer        PRIMARY KEY,
    config           jsonb          NOT NULL,
    "updatedAt"      timestamptz(6) NOT NULL DEFAULT now(),

    CONSTRAINT load_plan_config_delivery_type_fkey
      FOREIGN KEY ("deliveryTypeId") REFERENCES delivery_type_master(id) ON DELETE RESTRICT,
    CONSTRAINT chk_load_plan_config_object CHECK (jsonb_typeof(config) = 'object')
  );

  -- ── The Upcountry rules ───────────────────────────────────────────────────
  INSERT INTO load_plan_config ("deliveryTypeId", config)
  VALUES (
    v_type,
    jsonb_build_object(
      'smallMaxKg', 2000,
      'bigMaxKg',   3000,
      'mainRouteIds', jsonb_build_array(v_ids->'Navsari', v_ids->'Vapi', v_ids->'Bharuch'),
      'partners', jsonb_build_array(
        jsonb_build_object('routeId', v_ids->'Chikhli', 'joins', jsonb_build_array(v_ids->'Vapi', v_ids->'Navsari'), 'pick', 'most_space'),
        jsonb_build_object('routeId', v_ids->'Vansda',  'joins', jsonb_build_array(v_ids->'Navsari', v_ids->'Vapi'), 'pick', 'in_order'),
        jsonb_build_object('routeId', v_ids->'Bardoli', 'joins', jsonb_build_array(v_ids->'Navsari'),               'pick', 'in_order'),
        jsonb_build_object('routeId', v_ids->'Kamrej',  'joins', jsonb_build_array(v_ids->'Bharuch'),               'pick', 'in_order')
      )
    )
  );
END $$;

-- ── CHECK (read-only) — the row, with every route id read back as its name ──
-- Expect ONE row: Upcountry · small 2000 · big 3000 · main Navsari, Vapi,
-- Bharuch · partners
--   Chikhli → Vapi, Navsari (most_space)
--   Vansda  → Navsari, Vapi (in_order)
--   Bardoli → Navsari (in_order)
--   Kamrej  → Bharuch (in_order)
-- Ids on 2026-09-19 (cross-check only; the script never uses them):
-- Navsari 11 · Vapi 12 · Bharuch 17 · Chikhli 21 · Vansda 13 · Bardoli 14 · Kamrej 19.
SELECT d.name AS delivery_type,
       c.config->>'smallMaxKg' AS small_max_kg,
       c.config->>'bigMaxKg'   AS big_max_kg,
       (SELECT string_agg(rm.name || ' (' || rm.id || ')', ', ' ORDER BY m.ord)
          FROM jsonb_array_elements_text(c.config->'mainRouteIds') WITH ORDINALITY AS m(id, ord)
          JOIN route_master rm ON rm.id = m.id::int) AS main_routes,
       (SELECT string_agg(
                 pr.name || ' → ' ||
                 (SELECT string_agg(jr.name, ', ' ORDER BY j.ord)
                    FROM jsonb_array_elements_text(p.value->'joins') WITH ORDINALITY AS j(id, ord)
                    JOIN route_master jr ON jr.id = j.id::int) ||
                 ' (' || (p.value->>'pick') || ')', ' · ' ORDER BY p.ord)
          FROM jsonb_array_elements(c.config->'partners') WITH ORDINALITY AS p(value, ord)
          JOIN route_master pr ON pr.id = (p.value->>'routeId')::int) AS partners,
       c."updatedAt"
FROM load_plan_config c
JOIN delivery_type_master d ON d.id = c."deliveryTypeId";
