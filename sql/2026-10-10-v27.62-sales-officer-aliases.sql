-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-10-10 · Sales officer ALIAS DICTIONARY — proposed Schema v27.62
-- RUN STATUS: NOT RUN. Run once, top to bottom, in the Supabase SQL Editor
-- (Smart Flow). Every statement is IF NOT EXISTS / OR REPLACE, so a re-run is
-- harmless.
--
-- ⚠ VERSION CLASH TO WATCH. CORE header AND footer read v136 · Schema v27.61 on
-- 2026-10-10, so the next number is v27.62 — but sql/2026-10-10-order-invoices-
-- ddl.sql (another session, untracked, NOT RUN) proposes v27.62 too. The number
-- is minted by whichever is RUN first; the other renumbers to v27.63 (the
-- v27.59 / v27.60 precedent). Mint it in CORE §7 in the same commit as the
-- prisma edit, after the run — not before.
--
-- WHY. A sales officer's name arrives as free text — mo_orders."soName" (the
-- mail order, the Floor / Trip Sheets SO for every bill outside divisions
-- 74/77) and delivery_point_contacts."name" (the challan cascade's step c).
-- One person, many spellings: "(JSW) Rahul Pal", "RAHULPAL",
-- "RAHUL PAL - 9714487000", "Rahul Pla". This adds a dictionary:
--     so_alias_key(spelling) → "aliasKey" → sales_officer_aliases → sales_officer_master.id
-- Filling it is a SEPARATE step (data SQL, later). No UI in this change.
--
-- LIVE FACTS this file is written against (read-only SELECT, 2026-10-10):
--   sales_officer_master: 13 rows; id integer serial (nextval) — siblings
--   customer_sales_officers / sales_officer_group / so_order_access are serial
--   too, so the alias id is serial. Only constraint: sales_officer_master_pkey.
--   ⚠ Three live-vs-prisma differences, recorded, NOT fixed here:
--     · a live column "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
--       that schema.prisma does not declare;
--     · "employeeCode" is NULLABLE live, String (NOT NULL) in prisma;
--     · email is @unique in prisma but has NO unique constraint live.
--   sales_officer_aliases and so_alias_key() do not exist yet.
--
-- Supabase SQL Editor rules: no BEGIN/COMMIT; "check" is reserved (not used as
-- a name); UNION ALL columns cast ::text.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. The display name a person should be shown as (filled later) ─────────
ALTER TABLE sales_officer_master ADD COLUMN IF NOT EXISTS "displayName" text NULL;


-- ── 2. The normaliser — ONE definition of "the same spelling" ──────────────
-- lowercase → drop a leading "(jsw)" or "jsw " → drop digits (typed phones) →
-- drop everything that is not a–z. Empty → NULL. IMMUTABLE: same input, same
-- key, forever — so it can back an index or a CHECK later.
--
-- Samples (checked read-only against the live database, 2026-10-10, with the
-- same expression inline):
--   so_alias_key('(JSW) Rahul Pal')                → 'rahulpal'
--   so_alias_key('RAHULPAL')                       → 'rahulpal'
--   so_alias_key('RAHUL PAL - 9714487000')         → 'rahulpal'
--   so_alias_key('Rahul Pla')                      → 'rahulpla'   (a typo: its OWN alias row)
--   so_alias_key('(JSW) Jha Roopesh Ghanshyam')    → 'jharoopeshghanshyam'
--   so_alias_key('LAKHAN MALI - 7490804502')       → 'lakhanmali'
--   so_alias_key('sunil nishad')                   → 'sunilnishad'
--   so_alias_key('SHIVPAL - 8488843430')           → 'shivpal'
--   so_alias_key('JSW Pravesh Chitre')             → 'praveshchitre'
--   so_alias_key(' ( jsw )  Kundan Kumar Singh')   → 'kundankumarsingh'
--   so_alias_key('Jswanth Rao')                    → 'jswanthrao' (only a "jsw " WORD is a prefix)
--   so_alias_key('9714487000')                     → NULL
--   so_alias_key('')                               → NULL
--   so_alias_key(NULL)                             → NULL
CREATE OR REPLACE FUNCTION so_alias_key(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURNS NULL ON NULL INPUT
AS $fn$
  SELECT nullif(
           regexp_replace(
             regexp_replace(
               regexp_replace(lower(raw),
                 '^[[:space:]]*(\([[:space:]]*jsw[[:space:]]*\)|jsw[[:space:]]+)', ''),
               '[0-9]+', '', 'g'),
             '[^a-z]', '', 'g'),
           '')
$fn$;


-- ── 3. The dictionary ───────────────────────────────────────────────────────
-- One row per normalised spelling. A spelling maps to exactly ONE person
-- (UNIQUE "aliasKey"); a person has many spellings. Deleting a master row
-- takes its spellings with it (CASCADE) — they mean nothing without it.
-- Constraint and index names are Prisma's own defaults for this shape, so the
-- prisma model needs no map: arguments.
CREATE TABLE IF NOT EXISTS sales_officer_aliases (
  id               serial PRIMARY KEY,
  "aliasKey"       text NOT NULL,
  "rawExample"     text NULL,
  "salesOfficerId" integer NOT NULL,
  "createdAt"      timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "sales_officer_aliases_aliasKey_key" UNIQUE ("aliasKey"),
  CONSTRAINT "sales_officer_aliases_salesOfficerId_fkey"
    FOREIGN KEY ("salesOfficerId") REFERENCES sales_officer_master(id) ON DELETE CASCADE,
  -- A key must already BE a key: letters only, never empty. Insert through
  -- so_alias_key(...) and this always holds.
  CONSTRAINT chk_sales_officer_aliases_key CHECK ("aliasKey" ~ '^[a-z]+$')
);

CREATE INDEX IF NOT EXISTS "sales_officer_aliases_salesOfficerId_idx"
  ON sales_officer_aliases ("salesOfficerId");

-- ⚠ LIVE FEED (CORE §13): no live_changes trigger here ON PURPOSE — no screen
-- reads this table yet. The commit that makes Floor / Trip Sheets read it adds
-- the trigger in the same change.


-- ── 4. VERIFY (read-only) ───────────────────────────────────────────────────
SELECT '1 column sales_officer_master.displayName'::text AS item,
       (data_type || ' · nullable ' || is_nullable)::text AS detail
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'sales_officer_master' AND column_name = 'displayName'
UNION ALL
SELECT '2 table sales_officer_aliases', (to_regclass('public.sales_officer_aliases') IS NOT NULL)::text
UNION ALL
SELECT '3 column ' || column_name::text, (data_type || ' · nullable ' || is_nullable || ' · default ' || coalesce(column_default, '—'))::text
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'sales_officer_aliases'
UNION ALL
SELECT '4 constraint ' || con.conname::text, pg_get_constraintdef(con.oid)::text
FROM pg_constraint con
WHERE con.conrelid = to_regclass('public.sales_officer_aliases')
UNION ALL
SELECT '5 index ' || indexname::text, indexdef::text
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'sales_officer_aliases'
UNION ALL
SELECT '6 function so_alias_key', (p.provolatile = 'i')::text || ' (immutable)'
FROM pg_proc p
WHERE p.proname = 'so_alias_key'
UNION ALL
SELECT '7 so_alias_key sample ' || s.raw, coalesce(so_alias_key(s.raw), 'NULL')::text
FROM (VALUES ('(JSW) Rahul Pal'), ('RAHUL PAL - 9714487000'), ('Rahul Pla'), ('9714487000')) AS s(raw)
ORDER BY 1;
