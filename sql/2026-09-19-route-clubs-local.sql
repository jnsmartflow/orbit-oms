-- ============================================================================
-- 2026-09-19 · Floor · By route cards — COMMIT 2 of 5: the three Local clubs
--
-- Seeds route_clubs / route_club_members (created by
-- sql/2026-09-19-route-clubs.sql) with the Local clubs, in card order:
--   1. Adajan + Olpad      Adajan main,   Olpad sub
--   2. Ghod Dod + Udhana   Ghod Dod main, Udhana sub
--   3. Varachha + Kamrej   Varachha main, Kamrej sub
--
-- ONE SCRIPT, ALL OR NOTHING. Paste the whole file and run it once.
--
-- 🔴 NO BEGIN/COMMIT — THE DO BLOCK IS THE TRANSACTION. House rule for the
-- Supabase SQL Editor is no BEGIN/COMMIT wrappers. A DO block is ONE statement,
-- and Postgres runs one statement atomically: any RAISE EXCEPTION inside it
-- undoes every insert it has made. So the owner's requirement — a route name
-- that does not match exactly one route fails the whole seed, never a partial
-- club — is met by the block itself.
--
-- 🔴 NO ID IS HARD-CODED. The delivery type and all six routes are looked up BY
-- NAME, exact match, and EVERY name is validated before the first INSERT.
--
-- ⚠ A SECOND RUN FAILS, deliberately: UNIQUE ("deliveryTypeId", name) on
-- route_clubs rejects the first club again, and the block rolls back whole.
--
-- ⚠ Kamrej has no Local area (all 10 of its areas are Upcountry). It is in a
-- Local club by the owner's decision of 2026-09-19; the tables do not check a
-- member against its areas, on purpose.
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
  SELECT count(*) INTO v_n FROM delivery_type_master WHERE name = 'Local';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Delivery type "Local" matches % rows, expected exactly 1 — nothing inserted', v_n;
  END IF;
  SELECT id INTO v_type_id FROM delivery_type_master WHERE name = 'Local';

  -- ── Validate EVERY route before inserting anything ────────────────────────
  FOR r IN
    SELECT * FROM (VALUES
      (1, 'Adajan + Olpad',    1, 'Adajan'),
      (1, 'Adajan + Olpad',    2, 'Olpad'),
      (2, 'Ghod Dod + Udhana', 1, 'Ghod Dod'),
      (2, 'Ghod Dod + Udhana', 2, 'Udhana'),
      (3, 'Varachha + Kamrej', 1, 'Varachha'),
      (3, 'Varachha + Kamrej', 2, 'Kamrej')
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
      (1, 'Adajan + Olpad',    1, 'Adajan'),
      (1, 'Adajan + Olpad',    2, 'Olpad'),
      (2, 'Ghod Dod + Udhana', 1, 'Ghod Dod'),
      (2, 'Ghod Dod + Udhana', 2, 'Udhana'),
      (3, 'Varachha + Kamrej', 1, 'Varachha'),
      (3, 'Varachha + Kamrej', 2, 'Kamrej')
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
-- Expect 6 rows:
--   Local · 1 · Adajan + Olpad    · 1 main Adajan   (9)  · 2 sub Olpad  (24)
--   Local · 2 · Ghod Dod + Udhana · 1 main Ghod Dod (6)  · 2 sub Udhana (7)
--   Local · 3 · Varachha + Kamrej · 1 main Varachha (8)  · 2 sub Kamrej (19)
-- The ids are what production held on 2026-09-19 (read-only SELECT); the
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
