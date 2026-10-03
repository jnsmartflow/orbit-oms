-- ============================================================================
-- 2026-10-03 · Floor · By route cards — "Other routes" cleanup
--
-- Three owner decisions, one script:
--   1. New route "Q53D" (the depot's own billing). Area 314 "Surat" moves off
--      "No Route" (id 20) onto it, and so does any area_route_map row of area
--      314 pointing at 20. NO club for Q53D — it stays in Local "Other routes".
--   2. New Upcountry club "Surat outskirts", after the existing Upcountry
--      clubs, members in this order: Adajan, Varachha, Udhana, Ghod Dod, Olpad.
--   3. Area 209 "Khalal" → Cross, route Gujarat Mainland.
--      Area 133 "Vallabhipur" → Cross, route Saurashtra & Kutch.
--
-- 🔴 WHY "Surat outskirts" PULLS ONLY UPCOUNTRY BILLS (checked 2026-10-03).
-- A club member reaches across to another tab ONLY when its route has no area
-- of the club's own type (lib/floor/route-clubs.ts `reachFor` — the Kamrej
-- case). All five routes have Upcountry areas today, so every member reads the
-- Upcountry tab's own rows and never a Local bill:
--   Adajan 10 · Varachha 4 · Udhana 3 · Ghod Dod 1 (Khajod) · Olpad 1 (AMBHETA).
-- ⚠ Ghod Dod and Olpad hang on ONE empty area each. If Khajod (143) or AMBHETA
-- (157) is ever moved to Local, that route has no Upcountry area left and its
-- line in this club starts showing EVERY Local bill on the route. Remove the
-- route from the club first if that happens.
--
-- ONE SCRIPT, ALL OR NOTHING. Paste the whole file and run it.
--
-- 🔴 NO BEGIN/COMMIT — THE DO BLOCK IS THE TRANSACTION (house rule for the
-- Supabase SQL Editor). Any RAISE EXCEPTION inside it undoes everything.
--
-- 🔴 IDS BY NAME. Delivery types and routes are looked up by exact name; the
-- only literal ids are the owner's three areas (314, 209, 133), each checked
-- against its name before anything is written.
--
-- ✅ SAFE TO RUN TWICE. Inserts use ON CONFLICT on real unique keys
-- (route_master.name, route_clubs_type_name_key,
-- route_club_members_type_route_key); every UPDATE is guarded on the value it
-- replaces, so a second run matches nothing.
--
-- The SELECT at the end is READ-ONLY and is the result the editor shows.
-- ============================================================================

DO $$
DECLARE
  v_local_id     integer;
  v_upcountry_id integer;
  v_cross_id     integer;
  v_noroute_id   integer;
  v_q53d_id      integer;
  v_gm_id        integer;
  v_sk_id        integer;
  v_transport_id integer;
  v_club_id      integer;
  v_route_id     integer;
  v_n            integer;
  r              record;
BEGIN
  -- ── Delivery types, by name ───────────────────────────────────────────────
  FOR r IN SELECT * FROM (VALUES ('Local'), ('Upcountry'), ('Cross')) AS t(type_name) LOOP
    SELECT count(*) INTO v_n FROM delivery_type_master WHERE name = r.type_name;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'Delivery type "%" matches % rows, expected exactly 1 — nothing changed', r.type_name, v_n;
    END IF;
  END LOOP;
  SELECT id INTO v_local_id     FROM delivery_type_master WHERE name = 'Local';
  SELECT id INTO v_upcountry_id FROM delivery_type_master WHERE name = 'Upcountry';
  SELECT id INTO v_cross_id     FROM delivery_type_master WHERE name = 'Cross';

  -- ── Every existing route this script names, by name ───────────────────────
  FOR r IN
    SELECT * FROM (VALUES
      ('No Route'), ('Transport'), ('Gujarat Mainland'), ('Saurashtra & Kutch'),
      ('Adajan'), ('Varachha'), ('Udhana'), ('Ghod Dod'), ('Olpad')
    ) AS t(route_name)
  LOOP
    SELECT count(*) INTO v_n FROM route_master WHERE name = r.route_name;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'Route "%" matches % rows, expected exactly 1 — nothing changed', r.route_name, v_n;
    END IF;
  END LOOP;
  SELECT id INTO v_noroute_id   FROM route_master WHERE name = 'No Route';
  SELECT id INTO v_transport_id FROM route_master WHERE name = 'Transport';
  SELECT id INTO v_gm_id        FROM route_master WHERE name = 'Gujarat Mainland';
  SELECT id INTO v_sk_id        FROM route_master WHERE name = 'Saurashtra & Kutch';

  -- ── The owner's three areas: the id must still carry the expected name ────
  FOR r IN
    SELECT * FROM (VALUES (314, 'Surat'), (209, 'Khalal'), (133, 'Vallabhipur')) AS t(area_id, area_name)
  LOOP
    SELECT count(*) INTO v_n FROM area_master WHERE id = r.area_id AND name = r.area_name;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'Area % is not "%" — nothing changed', r.area_id, r.area_name;
    END IF;
  END LOOP;

  -- ── No Upcountry club already holds one of the five routes ────────────────
  -- (one club per route per type; ON CONFLICT below would otherwise skip it
  -- silently and leave the route in its old club)
  SELECT count(*) INTO v_n
    FROM route_club_members m
    JOIN route_clubs c ON c.id = m."clubId"
    JOIN route_master rt ON rt.id = m."routeId"
   WHERE m."deliveryTypeId" = v_upcountry_id
     AND c.name <> 'Surat outskirts'
     AND rt.name IN ('Adajan', 'Varachha', 'Udhana', 'Ghod Dod', 'Olpad');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% of the five routes are already in another Upcountry club — nothing changed', v_n;
  END IF;

  -- ── 1. Route Q53D, and area 314 onto it ───────────────────────────────────
  INSERT INTO route_master (name, "isActive", "bayNumber")
  VALUES ('Q53D', true, NULL)
  ON CONFLICT (name) DO NOTHING;
  SELECT id INTO v_q53d_id FROM route_master WHERE name = 'Q53D';

  UPDATE area_master
     SET "primaryRouteId" = v_q53d_id
   WHERE id = 314
     AND "primaryRouteId" = v_noroute_id;

  UPDATE area_route_map m
     SET "routeId" = v_q53d_id
   WHERE m."areaId" = 314
     AND m."routeId" = v_noroute_id
     AND NOT EXISTS (
       SELECT 1 FROM area_route_map x WHERE x."areaId" = 314 AND x."routeId" = v_q53d_id
     );

  -- ── 2. Upcountry club "Surat outskirts" ───────────────────────────────────
  INSERT INTO route_clubs ("deliveryTypeId", name, "sortOrder")
  SELECT v_upcountry_id, 'Surat outskirts', COALESCE(max("sortOrder"), 0) + 1
    FROM route_clubs
   WHERE "deliveryTypeId" = v_upcountry_id
  ON CONFLICT ("deliveryTypeId", name) DO NOTHING;
  SELECT id INTO v_club_id FROM route_clubs
   WHERE "deliveryTypeId" = v_upcountry_id AND name = 'Surat outskirts';

  FOR r IN
    SELECT * FROM (VALUES
      (1, 'Adajan'),
      (2, 'Varachha'),
      (3, 'Udhana'),
      (4, 'Ghod Dod'),
      (5, 'Olpad')
    ) AS t(route_sort, route_name)
    ORDER BY route_sort
  LOOP
    SELECT id INTO v_route_id FROM route_master WHERE name = r.route_name;
    INSERT INTO route_club_members ("clubId", "deliveryTypeId", "routeId", "sortOrder")
    VALUES (v_club_id, v_upcountry_id, v_route_id, r.route_sort)
    ON CONFLICT ("deliveryTypeId", "routeId") DO NOTHING;
  END LOOP;

  -- ── 3. Khalal and Vallabhipur → Cross (only from Upcountry / Transport) ───
  UPDATE area_master
     SET "deliveryTypeId" = v_cross_id,
         "primaryRouteId" = v_gm_id
   WHERE id = 209
     AND "deliveryTypeId" = v_upcountry_id
     AND "primaryRouteId" = v_transport_id;

  UPDATE area_master
     SET "deliveryTypeId" = v_cross_id,
         "primaryRouteId" = v_sk_id
   WHERE id = 133
     AND "deliveryTypeId" = v_upcountry_id
     AND "primaryRouteId" = v_transport_id;
END $$;

-- ── CHECK (read-only) ────────────────────────────────────────────────────────
-- Expect 10 rows:
--   1 route  · Q53D             · active true · bay (blank)
--   2 area   · 314 Surat        · Local       · Q53D
--   3 club   · Surat outskirts  · Upcountry   · sortOrder 6
--   4 member · 1 Adajan    5 member · 2 Varachha    6 member · 3 Udhana
--   7 member · 4 Ghod Dod  8 member · 5 Olpad
--   9 area   · 209 Khalal       · Cross       · Gujarat Mainland
--  10 area   · 133 Vallabhipur  · Cross       · Saurashtra & Kutch
SELECT *
FROM (
  SELECT 1::text                    AS n,
         'route'::text              AS chk,
         r.name::text               AS name,
         ('active ' || r."isActive"::text)::text AS detail,
         COALESCE(r."bayNumber"::text, '')       AS extra
  FROM route_master r
  WHERE r.name = 'Q53D'
  UNION ALL
  SELECT CASE a.id WHEN 314 THEN 2 WHEN 209 THEN 9 ELSE 10 END::text,
         'area'::text,
         (a.id::text || ' ' || a.name)::text,
         d.name::text,
         COALESCE(r.name, '')::text
  FROM area_master a
  JOIN delivery_type_master d ON d.id = a."deliveryTypeId"
  LEFT JOIN route_master r    ON r.id = a."primaryRouteId"
  WHERE a.id IN (314, 209, 133)
  UNION ALL
  SELECT 3::text,
         'club'::text,
         c.name::text,
         d.name::text,
         ('sortOrder ' || c."sortOrder"::text)::text
  FROM route_clubs c
  JOIN delivery_type_master d ON d.id = c."deliveryTypeId"
  WHERE c.name = 'Surat outskirts'
  UNION ALL
  SELECT (3 + m."sortOrder")::text,
         'member'::text,
         (m."sortOrder"::text || ' ' || r.name)::text,
         d.name::text,
         c.name::text
  FROM route_club_members m
  JOIN route_clubs c          ON c.id = m."clubId"
  JOIN route_master r         ON r.id = m."routeId"
  JOIN delivery_type_master d ON d.id = m."deliveryTypeId"
  WHERE c.name = 'Surat outskirts'
) x
ORDER BY x.n::int;
