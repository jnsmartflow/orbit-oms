-- =====================================================================
-- customer-intake.sql  ·  OrbitOMS reusable customer intake template
-- Run in: Supabase SQL Editor  ·  Never prisma db push
-- =====================================================================
--
-- WHY TWO TABLES:
--   A customer must be added in BOTH places, or it half-works.
--   1. mo_customer_keywords  -> makes the customer SEARCHABLE for the
--      sales team in /po, /place-order, /order.  (plain text, no FKs)
--   2. delivery_point_master -> the official customer record used by
--      admin, tint, challans, reports.  (area/route/type are FK IDs)
--
-- HOW TO USE:
--   1. Fill the @vars in STEP 0 for ONE customer.
--   2. Run STEP 1 (lookup) FIRST, alone. Read the ids it prints.
--   3. Put those ids into STEP 3 (master insert) where marked.
--   4. Run STEP 2, STEP 3, STEP 4 (verify).
--   5. Repeat per customer (copy this file again).
--
-- GOTCHAS baked in (learned the hard way):
--   * mo_customer_keywords has NO unique on customerCode ->
--     cannot use ON CONFLICT. Guard with WHERE NOT EXISTS.
--   * mo_customer_keywords.keyword is NOT NULL but unused by search ->
--     fill it with the customer name so the insert is valid.
--   * delivery_point_master.updatedAt is NOT NULL with NO db default ->
--     raw SQL MUST set updatedAt = now() (Prisma won't stamp it).
--   * delivery_point_master area/route/deliveryType are FK IDs, not text.
--     Look them up by name in STEP 1 before inserting.
--   * delivery_point_master.noDeliveryDays -> set '{}'.
--   * Required NOT NULL / no-default master cols: customerCode,
--     customerName, areaId  (+ updatedAt as above).
--
-- =====================================================================


-- ---------------------------------------------------------------------
-- STEP 0 — FILL THESE (one customer per run)
-- ---------------------------------------------------------------------
-- customerCode : SAP code, e.g. '3614630'
-- customerName : e.g. 'SHREE KASHTBHANJAN PAINTS'
-- areaText     : plain text for search display, e.g. 'NAVSARI'  (UPPERCASE, match nearby rows)
-- deliveryText : 'UPC' or 'LOCAL'  (keyword table text)
-- routeText    : e.g. 'NAVSARI'
-- areaName     : the area's real name in area_master, e.g. 'Navsari'
--                (used to find areaId in STEP 1 — mind spellings like "Varachha")


-- ---------------------------------------------------------------------
-- STEP 1 — LOOKUP master FK ids (run FIRST, read the output)
-- Replace the names below with this customer's area / route / delivery type.
-- ---------------------------------------------------------------------

-- 1a. Area id (mind double-h / prefixes — use a loose pattern)
SELECT 'areaId' AS need, id, name
FROM area_master
WHERE name ILIKE '%navsari%';          -- <-- change pattern to your area

-- 1b. Delivery type id  (1=Local, 2=Upcountry, 5=IGT, 6=Cross)
SELECT 'deliveryTypeId' AS need, id, name FROM delivery_type_master;

-- 1c. Route id (optional)
SELECT 'routeId' AS need, id, name
FROM route_master
WHERE name ILIKE '%navsari%';          -- <-- change pattern to your route

-- 1d. Does this customer already exist in the master? (UPDATE vs INSERT)
SELECT 'existing_master' AS need, id, "customerCode", "customerName", "areaId"
FROM delivery_point_master
WHERE "customerCode" = '3614630';      -- <-- your customerCode

-- >>> Note the ids from 1a/1b/1c, and whether 1d returned a row. <<<


-- ---------------------------------------------------------------------
-- STEP 2 — KEYWORD table (makes customer searchable)
-- Safe to run. Adds only if the code is not already present.
-- ---------------------------------------------------------------------
INSERT INTO mo_customer_keywords
  ("customerCode","customerName",area,"deliveryType",route,keyword)
SELECT
  '3614630',                              -- customerCode
  'SHREE KASHTBHANJAN PAINTS',            -- customerName
  'NAVSARI',                              -- areaText  (display)
  'UPC',                                  -- deliveryText
  'NAVSARI',                              -- routeText
  'SHREE KASHTBHANJAN PAINTS'             -- keyword (= name; required, unused by search)
WHERE NOT EXISTS (
  SELECT 1 FROM mo_customer_keywords WHERE "customerCode" = '3614630'
);


-- ---------------------------------------------------------------------
-- STEP 3 — MASTER table (official record)
-- Use ONE of 3a / 3b below.
--   3a if STEP 1d returned NO row  -> INSERT
--   3b if STEP 1d returned a row   -> UPDATE (e.g. fixing area)
-- Replace <AREA_ID> etc. with ids from STEP 1.
-- Optional FK ids may be left out (they are nullable).
-- ---------------------------------------------------------------------

-- 3a. INSERT (new customer). updatedAt = now() is MANDATORY.
INSERT INTO delivery_point_master
  ("customerCode","customerName","areaId","noDeliveryDays","updatedAt"
   /* , "primaryRouteId","dispatchDeliveryTypeId","reportingDeliveryTypeId" */ )
SELECT
  '3614630',                              -- customerCode
  'SHREE KASHTBHANJAN PAINTS',            -- customerName
  225,                                    -- <AREA_ID> from STEP 1a
  '{}',                                   -- noDeliveryDays
  now()                                   -- updatedAt (raw SQL must set this)
  /* , <ROUTE_ID>, <DTYPE_ID>, <DTYPE_ID> */
WHERE NOT EXISTS (
  SELECT 1 FROM delivery_point_master WHERE "customerCode" = '3614630'
);

-- 3b. UPDATE (existing customer — e.g. correct the area).
--     Comment out 3a and use this instead when STEP 1d found a row.
-- UPDATE delivery_point_master
-- SET "areaId" = 225,                     -- <AREA_ID> from STEP 1a
--     "updatedAt" = now()
-- WHERE "customerCode" = '3614630';


-- ---------------------------------------------------------------------
-- STEP 4 — VERIFY both tables
-- ---------------------------------------------------------------------
SELECT 'keyword' AS src, "customerCode","customerName",area
FROM mo_customer_keywords
WHERE "customerCode" = '3614630'
UNION ALL
SELECT 'master' AS src, "customerCode","customerName", "areaId"::text
FROM delivery_point_master
WHERE "customerCode" = '3614630';

-- =====================================================================
-- End. Copy this file per customer; fill STEP 0/1, run in order.
-- If the area does not exist in area_master, create it there first
-- (separate task) before pointing a customer at it.
-- =====================================================================
