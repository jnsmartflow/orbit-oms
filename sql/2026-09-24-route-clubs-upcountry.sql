-- ============================================================================
-- 2026-09-24 · Floor · By route cards — the five Upcountry clubs
--
-- Seeds route_clubs / route_club_members (created by
-- sql/2026-09-19-route-clubs.sql) with the Upcountry clubs, in card order:
--   1. Navsari            Navsari main
--   2. Chikhli + Vansda   Chikhli main, Vansda sub
--   3. Vapi               Vapi main      (Valsad, Dharampur, Silvassa are its areas)
--   4. Bardoli            Bardoli main   (Vyara, Mandvi, Songadh are its areas)
--   5. Bharuch + Kamrej   Bharuch main,  Kamrej sub
-- A one-route club is a card with one line.
--
-- Every other route with Upcountry bills — Adajan, Varachha, Udhana, Ghod Dod,
-- Olpad, Vyara (15), IGT / CROSS (18: Godhra), Transport (22: Vallabhipur,
-- Khalal) — lands on the display-only "Other routes" card, one line each, with
-- "No route" last (components/floor/route-cards.tsx). Nothing is written for it.
--
-- Same shape as sql/2026-09-19-route-clubs-local.sql:
--
-- 🔴 NO BEGIN/COMMIT — THE DO BLOCK IS THE TRANSACTION. A DO block is ONE
-- statement and runs atomically: any RAISE EXCEPTION inside it undoes every
-- insert it has made. A name that does not match exactly one row fails the whole
-- seed, never a partial club.
--
-- 🔴 NO ID IS HARD-CODED. The delivery type and all seven routes are looked up
-- BY NAME, exact match, and EVERY name is validated before the first INSERT.
--
-- ⚠ A SECOND RUN FAILS, deliberately: UNIQUE ("deliveryTypeId", name) on
-- route_clubs rejects the first club again, and the block rolls back whole.
--
-- ⚠ Kamrej is also in the Local "Varachha + Kamrej" club. UNIQUE
-- ("deliveryTypeId", "routeId") is per delivery type, so a route may sit in one
-- Local club and one Upcountry club. Its bills show on both tabs' cards;
-- putting them on a trip from either removes them from both.
--
-- The SELECT at the end is READ-ONLY and is the result the editor shows.
-- ============================================================================

DO $$
DECLARE
  v_type_id  integer;
  v_club_id  integer;
  v_route_id integer;
  v_n        integer;
  r          record;
BEGIN
  -- ── The delivery type, by name ────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM delivery_type_master WHERE name = 'Upcountry';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Delivery type "Upcountry" matches % rows, expected exactly 1 — nothing inserted', v_n;
  END IF;
  SELECT id INTO v_type_id FROM delivery_type_master WHERE name = 'Upcountry';

  -- ── Validate EVERY route before inserting anything ────────────────────────
  FOR r IN
    SELECT * FROM (VALUES
      (1, 'Navsari',          1, 'Navsari'),
      (2, 'Chikhli + Vansda', 1, 'Chikhli'),
      (2, 'Chikhli + Vansda', 2, 'Vansda'),
      (3, 'Vapi',             1, 'Vapi'),
      (4, 'Bardoli',          1, 'Bardoli'),
      (5, 'Bharuch + Kamrej', 1, 'Bharuch'),
      (5, 'Bharuch + Kamrej', 2, 'Kamrej')
    ) AS t(club_sort, club_name, route_sort, route_name)
  LOOP
    SELECT count(*) INTO v_n FROM route_master WHERE name = r.route_name;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'Route "%" matches % rows, expected exactly 1 — nothing inserted', r.route_name, v_n;
    END IF;
  END LOOP;

  -- ── Insert, club by club, main route first ────────────────────────────────
  FOR r IN
    SELECT * FROM (VALUES
      (1, 'Navsari',          1, 'Navsari'),
      (2, 'Chikhli + Vansda', 1, 'Chikhli'),
      (2, 'Chikhli + Vansda', 2, 'Vansda'),
      (3, 'Vapi',             1, 'Vapi'),
      (4, 'Bardoli',          1, 'Bardoli'),
      (5, 'Bharuch + Kamrej', 1, 'Bharuch'),
      (5, 'Bharuch + Kamrej', 2, 'Kamrej')
    ) AS t(club_sort, club_name, route_sort, route_name)
    ORDER BY club_sort, route_sort
  LOOP
    IF r.route_sort = 1 THEN
      INSERT INTO route_clubs ("deliveryTypeId", name, "sortOrder")
      VALUES (v_type_id, r.club_name, r.club_sort)
      RETURNING id INTO v_club_id;
    END IF;

    SELECT id INTO v_route_id FROM route_master WHERE name = r.route_name;

    INSERT INTO route_club_members ("clubId", "deliveryTypeId", "routeId", "sortOrder")
    VALUES (v_club_id, v_type_id, v_route_id, r.route_sort);
  END LOOP;
END $$;

-- ── CHECK (read-only) — every club and its members, in card order ───────────
-- Expect 13 rows: the 6 Local rows unchanged, then 7 Upcountry rows:
--   Upcountry · 1 · Navsari          · 1 main Navsari (11)
--   Upcountry · 2 · Chikhli + Vansda · 1 main Chikhli (21) · 2 sub Vansda (13)
--   Upcountry · 3 · Vapi             · 1 main Vapi    (12)
--   Upcountry · 4 · Bardoli          · 1 main Bardoli (14)
--   Upcountry · 5 · Bharuch + Kamrej · 1 main Bharuch (17) · 2 sub Kamrej (19)
-- The ids are what production held on 2026-09-24 (read-only SELECT); the
-- script above never uses them — they are here only to cross-check.
SELECT d.name              AS delivery_type,
       c."sortOrder"       AS club_order,
       c.name              AS club,
       m."sortOrder"       AS route_order,
       CASE m."sortOrder" WHEN 1 THEN 'main' ELSE 'sub' END AS role,
       r.name              AS route,
       r.id                AS route_id
FROM route_clubs c
JOIN delivery_type_master d ON d.id = c."deliveryTypeId"
JOIN route_club_members m   ON m."clubId" = c.id
JOIN route_master r         ON r.id = m."routeId"
ORDER BY d.name, c."sortOrder", m."sortOrder";
