-- ============================================================================
-- 2026-10-02 · Floor · By route cards — the IGT / Cross tab's clubs
--
-- The single route "IGT / CROSS" (id 18) was split on 2026-10-02 into six
-- routes. This seeds route_clubs / route_club_members (created by
-- sql/2026-09-19-route-clubs.sql) with ONE club per new route, in card order:
--   1. Gujarat Mainland
--   2. Saurashtra & Kutch
--   3. Maharashtra & Goa
--   4. North India
--   5. South India
--   6. East & Central India
-- "IGT / CROSS" (id 18, 0 areas) gets NO club.
--
-- 🔴 THE CLUBS ARE TYPED "Cross", NOT "IGT". The IGT / Cross tab covers both
-- types (lib/floor/scope.ts) and draws a club of either; the code that reads
-- them matches by the tab's types since 2026-10-02 (components/floor/
-- route-cards.tsx `clubOnTab`). Cross because every one of the six routes has
-- Cross areas, so lib/floor/route-clubs.ts gives each member `reachFrom` null —
-- the card takes the tab's own rows, IGT and Cross both.
--
-- Also moves the area Godhra from Upcountry to Cross. It was the ONE Upcountry
-- area on Gujarat Mainland (read 2026-10-02), which put an Upcountry bill
-- under an IGT/Cross route on the Upcountry tab.
--
-- ONE SCRIPT, ALL OR NOTHING. Paste the whole file and run it.
--
-- 🔴 NO BEGIN/COMMIT — THE DO BLOCK IS THE TRANSACTION (house rule for the
-- Supabase SQL Editor). A DO block is ONE statement and Postgres runs it
-- atomically: any RAISE EXCEPTION inside it undoes everything it did.
--
-- 🔴 NO ID IS HARD-CODED. Both delivery types and all six routes are looked up
-- BY NAME, exact match, and EVERY name is validated before the first write.
--
-- ✅ SAFE TO RUN TWICE (unlike the Local seed, which failed on a second run).
-- The Godhra UPDATE only matches while Godhra is still Upcountry. A club
-- insert does nothing on UNIQUE ("deliveryTypeId", name)
-- (route_clubs_type_name_key) and the club's id is then read back; a member
-- insert does nothing on UNIQUE ("deliveryTypeId", "routeId")
-- (route_club_members_type_route_key).
--
-- The SELECT at the end is READ-ONLY and is the result the editor shows.
-- ============================================================================

DO $$
DECLARE
  v_cross_id     integer;
  v_upcountry_id integer;
  v_club_id      integer;
  v_route_id     integer;
  v_n            integer;
  r              record;
BEGIN
  -- ── The delivery types, by name ───────────────────────────────────────────
  SELECT count(*) INTO v_n FROM delivery_type_master WHERE name = 'Cross';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Delivery type "Cross" matches % rows, expected exactly 1 — nothing changed', v_n;
  END IF;
  SELECT id INTO v_cross_id FROM delivery_type_master WHERE name = 'Cross';

  SELECT count(*) INTO v_n FROM delivery_type_master WHERE name = 'Upcountry';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Delivery type "Upcountry" matches % rows, expected exactly 1 — nothing changed', v_n;
  END IF;
  SELECT id INTO v_upcountry_id FROM delivery_type_master WHERE name = 'Upcountry';

  -- ── Validate EVERY route before writing anything ──────────────────────────
  FOR r IN
    SELECT * FROM (VALUES
      (1, 'Gujarat Mainland'),
      (2, 'Saurashtra & Kutch'),
      (3, 'Maharashtra & Goa'),
      (4, 'North India'),
      (5, 'South India'),
      (6, 'East & Central India')
    ) AS t(club_sort, route_name)
  LOOP
    SELECT count(*) INTO v_n FROM route_master WHERE name = r.route_name;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'Route "%" matches % rows, expected exactly 1 — nothing changed', r.route_name, v_n;
    END IF;
  END LOOP;

  -- ── Godhra → Cross (a no-op once it is Cross) ─────────────────────────────
  UPDATE area_master
     SET "deliveryTypeId" = v_cross_id
   WHERE name = 'Godhra'
     AND "deliveryTypeId" = v_upcountry_id;

  -- ── Insert, one club per route, the route its only (main) member ──────────
  FOR r IN
    SELECT * FROM (VALUES
      (1, 'Gujarat Mainland'),
      (2, 'Saurashtra & Kutch'),
      (3, 'Maharashtra & Goa'),
      (4, 'North India'),
      (5, 'South India'),
      (6, 'East & Central India')
    ) AS t(club_sort, route_name)
    ORDER BY club_sort
  LOOP
    INSERT INTO route_clubs ("deliveryTypeId", name, "sortOrder")
    VALUES (v_cross_id, r.route_name, r.club_sort)
    ON CONFLICT ("deliveryTypeId", name) DO NOTHING;

    SELECT id INTO v_club_id FROM route_clubs
     WHERE "deliveryTypeId" = v_cross_id AND name = r.route_name;

    SELECT id INTO v_route_id FROM route_master WHERE name = r.route_name;

    INSERT INTO route_club_members ("clubId", "deliveryTypeId", "routeId", "sortOrder")
    VALUES (v_club_id, v_cross_id, v_route_id, 1)
    ON CONFLICT ("deliveryTypeId", "routeId") DO NOTHING;
  END LOOP;
END $$;

-- ── CHECK (read-only) ────────────────────────────────────────────────────────
-- Expect 7 rows:
--   club · Cross · 1 · Gujarat Mainland     · Gujarat Mainland
--   club · Cross · 2 · Saurashtra & Kutch   · Saurashtra & Kutch
--   club · Cross · 3 · Maharashtra & Goa    · Maharashtra & Goa
--   club · Cross · 4 · North India          · North India
--   club · Cross · 5 · South India          · South India
--   club · Cross · 6 · East & Central India · East & Central India
--   area · Cross ·   · Godhra               · Gujarat Mainland
SELECT *
FROM (
  SELECT 'club'::text            AS chk,
         d.name::text            AS delivery_type,
         c."sortOrder"::text     AS club_order,
         c.name::text            AS club_or_area,
         r.name::text            AS route
  FROM route_clubs c
  JOIN delivery_type_master d ON d.id = c."deliveryTypeId"
  JOIN route_club_members m   ON m."clubId" = c.id
  JOIN route_master r         ON r.id = m."routeId"
  WHERE d.name = 'Cross'
  UNION ALL
  SELECT 'area'::text,
         d.name::text,
         NULL::text,
         a.name::text,
         r.name::text
  FROM area_master a
  JOIN delivery_type_master d ON d.id = a."deliveryTypeId"
  LEFT JOIN route_master r    ON r.id = a."primaryRouteId"
  WHERE a.name = 'Godhra'
) x
ORDER BY x.chk DESC, x.club_order;
