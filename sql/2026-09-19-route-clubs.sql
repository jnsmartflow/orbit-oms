-- ============================================================================
-- 2026-09-19 · Floor · By route cards — COMMIT 1 of 5: the two club tables
--
-- A CLUB is a set of routes that share one truck on a light day, shown as one
-- card on the floor's By route view. A club belongs to ONE delivery type: Kamrej
-- sits in "Varachha + Kamrej" on Local and will sit in a different club on
-- Upcountry. So the rule the database must hold is:
--
--     a route is in AT MOST ONE club PER DELIVERY TYPE.
--
-- route_master cannot carry this — a route has no delivery type of its own (the
-- type lives on area_master), and six routes have areas in both Local and
-- Upcountry. Hence two new tables.
--
-- ⚠ MEMBERSHIP IS NOT CHECKED AGAINST AREAS, DELIBERATELY. Kamrej (route 19)
-- has no Local area at all, and the owner's decision (2026-09-19) is that the
-- Local card still shows Kamrej's bills. A club says "these routes travel
-- together on this tab", nothing about where their areas are.
--
-- THIS FILE CREATES THE TABLES ONLY. No rows — the three Local clubs are
-- commit 2's SQL. No code reads either table until then, so this is safe to run
-- at any time, before or after any deploy.
--
-- ── RUN ORDER — EACH STEP IS ITS OWN RUN IN THE SQL EDITOR ──────────────────
--   STEP 1 → STEP 2 → STEP 3 (read-only check)
--   Then: schema.prisma hand-edit + `npx prisma generate` (never db push/pull).
--
-- Plain CREATE TABLE, not IF NOT EXISTS: a second run should FAIL LOUDLY rather
-- than silently keep a table of a different shape.
-- No BEGIN/COMMIT (Supabase SQL Editor).
-- ============================================================================


-- ============================================================================
-- STEP 1 — route_clubs
--
-- One row per club. `name` is the card heading ("Adajan + Olpad"); `sortOrder`
-- is the card's fixed place in row 1, per delivery type (1 = leftmost).
--
-- 🔴 UNIQUE (id, "deliveryTypeId") LOOKS REDUNDANT AND IS LOAD-BEARING. `id` is
-- already unique on its own; this pair exists only as the TARGET of the
-- composite foreign key in STEP 2, which is what lets the members table enforce
-- "one club per route per delivery type". Do not drop it.
--
-- RESTRICT on the delivery type: a type with clubs cannot be deleted from under
-- them. No extra indexes — a handful of rows.
-- ============================================================================

CREATE TABLE route_clubs (
  id               SERIAL       PRIMARY KEY,
  "deliveryTypeId" INTEGER      NOT NULL,
  name             TEXT         NOT NULL,
  "sortOrder"      INTEGER      NOT NULL,
  "createdAt"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT route_clubs_delivery_type_fkey
    FOREIGN KEY ("deliveryTypeId") REFERENCES delivery_type_master(id) ON DELETE RESTRICT,

  CONSTRAINT route_clubs_id_type_key    UNIQUE (id, "deliveryTypeId"),
  CONSTRAINT route_clubs_type_name_key  UNIQUE ("deliveryTypeId", name),
  CONSTRAINT route_clubs_type_sort_key  UNIQUE ("deliveryTypeId", "sortOrder"),
  CONSTRAINT chk_route_clubs_sort       CHECK ("sortOrder" >= 1)
);


-- ============================================================================
-- STEP 2 — route_club_members
--
-- One row per route in a club. sortOrder 1 = the MAIN route, 2 = the sub. The
-- card lists them in this order.
--
-- 🔴 "deliveryTypeId" IS COPIED ONTO THE MEMBER ON PURPOSE. A unique constraint
-- can only see columns of its own table, and the rule is per delivery type, so
-- the type has to be here. The composite FK ("clubId","deliveryTypeId") →
-- route_clubs(id,"deliveryTypeId") makes it impossible for the copy to disagree
-- with the club's own type: a member row claiming Local on an Upcountry club is
-- rejected. With that in place, UNIQUE ("deliveryTypeId","routeId") IS the rule.
--
-- CASCADE from the club: a member is PART of its club (trip_drops' reasoning).
-- RESTRICT on the route: a route in a club cannot be deleted from under it.
-- ============================================================================

CREATE TABLE route_club_members (
  id               SERIAL   PRIMARY KEY,
  "clubId"         INTEGER  NOT NULL,
  "deliveryTypeId" INTEGER  NOT NULL,
  "routeId"        INTEGER  NOT NULL,
  "sortOrder"      INTEGER  NOT NULL,

  CONSTRAINT route_club_members_club_fkey
    FOREIGN KEY ("clubId", "deliveryTypeId")
    REFERENCES route_clubs(id, "deliveryTypeId") ON DELETE CASCADE,

  CONSTRAINT route_club_members_route_fkey
    FOREIGN KEY ("routeId") REFERENCES route_master(id) ON DELETE RESTRICT,

  -- THE RULE: a route is in at most one club per delivery type.
  CONSTRAINT route_club_members_type_route_key UNIQUE ("deliveryTypeId", "routeId"),
  -- No two members share a position in one club (1 = main).
  CONSTRAINT route_club_members_club_sort_key  UNIQUE ("clubId", "sortOrder"),
  CONSTRAINT chk_route_club_members_sort       CHECK ("sortOrder" >= 1)
);


-- ============================================================================
-- STEP 3 — CHECK (read-only)
--
-- Expect 20 rows (10 columns + 10 constraints):
--   columns      route_clubs ×5, route_club_members ×5 — types as declared above,
--                every one NOT NULL (is_nullable = NO)
--   constraints  route_clubs: 1 FOREIGN KEY, 3 UNIQUE, 1 CHECK (plus the PK and
--                Postgres' own NOT NULL checks, filtered out below)
--                route_club_members: 2 FOREIGN KEY, 2 UNIQUE, 1 CHECK
-- (The editor shows only the last statement, hence one UNION ALL.)
-- ============================================================================

SELECT 'column' AS kind, table_name AS tbl, column_name AS name,
       data_type || ' · nullable=' || is_nullable AS detail
FROM information_schema.columns
WHERE table_name IN ('route_clubs', 'route_club_members')
UNION ALL
SELECT 'constraint', tc.table_name, tc.constraint_name, tc.constraint_type
FROM information_schema.table_constraints tc
WHERE tc.table_name IN ('route_clubs', 'route_club_members')
  AND tc.constraint_type IN ('FOREIGN KEY', 'UNIQUE', 'CHECK')
  AND tc.constraint_name NOT LIKE '%_not_null'
ORDER BY 1, 2, 3;
