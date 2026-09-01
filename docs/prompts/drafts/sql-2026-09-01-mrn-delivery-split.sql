-- ============================================================================
-- MRN — delivery-number split: STEP 2 of 6, SCHEMA ONLY
-- ============================================================================
-- Target : Supabase SQL Editor (production). Paste and Run as ONE block.
-- Date   : 2026-09-01
-- Live   : PostgreSQL 17.6 · 13 mrn · 377 mrn_lines · 370 mrn_line_batches
--          · 10 mrn_photos (all on MRN-2026-00013)
--
-- WHY
--   One STI can carry several delivery numbers. The delivery number moves from
--   the MRN HEADER onto the LINES, so billing's screen can show a tab per
--   delivery number. Owner change, 2026-09-01.
--
-- WHAT THIS DOES
--   1. Prints the before picture
--   2. Adds mrn_lines."deliveryNo" text NOT NULL DEFAULT ''
--   3. Backfills it from each MRN's header delivery number
--   4. (COMMENTED OUT) would drop the default — deferred to step 5, see below
--   5. Swaps the unique index: (mrnId, lineNo) -> (mrnId, deliveryNo, lineNo),
--      plus a plain (mrnId, deliveryNo) for the tab grouping
--   6. Verifies all of it in one labelled result
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   * `mrn."deliveryNo"` IS NOT TOUCHED. Owner ruling: the header column stays
--     and becomes LEGACY — still there, no longer written. It is NOT dropped in
--     this file or any other without a fresh decision, and there is a live
--     reader that would break if it were: components/mrn/supervisor-card.tsx:64
--     renders "Dly {deliveryNo}" off the BOARD ROW on the supervisor's To-check
--     tab. That is the only place the phone shows a delivery number at all.
--   * No DELETE, no DROP TABLE, no touch of mrn_photos or any other table.
--   * No Prisma edit and no `npx prisma generate` — that is step 3.
--
-- ============================================================================
-- ✅ THIS WHOLE FILE IS SAFE TO PASTE AND RUN IN ONE GO
-- ============================================================================
-- The one statement that was NOT safe — Part 4's DROP DEFAULT — is COMMENTED
-- OUT, per CORE §3's rule on commenting out anything that must not run yet.
-- Everything that remains is additive: a column with a default, a backfill, and
-- an index swap. Nothing here can leave an MRN without its lines.
--
-- Part 4 is deferred because the paste route still inserts without a delivery
-- number, and dropping the default would make it fail AFTER its deleteMany —
-- emptying the truck. Its own block below carries the full reasoning and says
-- where the instruction to uncomment it comes from: STEP 5.
--
-- ============================================================================
-- 🔴 IDENTIFIER CASE-FOLDING — THE TRAP THIS REPO HAS ALREADY FALLEN INTO
-- ============================================================================
-- Postgres folds every UNQUOTED identifier to lower case. On 2026-09-01 four
-- constraint names in sql-2026-08-31-mrn-photos-otr.sql were written unquoted,
-- came out lower-cased, and had to be renamed by hand
-- (mrn_photos_storagepath_key and three FKs). Every mixed-case identifier in
-- this file is DOUBLE-QUOTED for that reason.
--
-- ⚠ THE SAFE OPTIONS ARE "QUOTE IT" OR "OMIT IT" — never "name it unquoted".
-- Postgres auto-generates a name from the stored COLUMN name, so an unnamed
-- object comes out correctly cased; it is the explicitly-named-but-unquoted
-- ones that fold.
--
-- CORE §3 COMPLIANCE
--   * No BEGIN / COMMIT wrapper.
--   * No ON CONFLICT (nothing here inserts).
--   * Every LIMIT inside a UNION ALL is subquery-wrapped (there are none).
--   * Columns are camelCase and double-quoted. NO @map — @map causes P2022.
--
-- ⚠ THE EDITOR SHOWS ONLY THE LAST STATEMENT'S RESULT. Running the whole file
--   displays PART 6 ONLY. Select and run PART 1 on its own first if you want
--   the before picture.
-- ============================================================================


-- ============================================================================
-- PART 1 — BEFORE. Nothing below this line changes anything.
--          Select and run this part ON ITS OWN to see the current state.
-- ============================================================================
SELECT * FROM (
  SELECT
    '1. lineNo unique index BEFORE'::text AS item,
    COALESCE(MAX(indexdef), '(missing)')::text AS detail
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'mrn_lines'
    AND indexname = 'mrn_lines_mrnId_lineNo_key'

  UNION ALL
  SELECT
    '2. all indexes on mrn_lines BEFORE'::text,
    COALESCE(string_agg(indexname, ', ' ORDER BY indexname), '(none)')::text
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'mrn_lines'

  UNION ALL
  SELECT
    '3. mrn_lines."deliveryNo" BEFORE'::text,
    COALESCE(string_agg(column_name, ', '), '(does not exist — expected)')::text
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'mrn_lines'
    AND column_name = 'deliveryNo'

  UNION ALL
  SELECT
    '4. row counts BEFORE'::text,
    ( (SELECT COUNT(*) FROM mrn)::text              || ' mrn, ' ||
      (SELECT COUNT(*) FROM mrn_lines)::text        || ' mrn_lines, ' ||
      (SELECT COUNT(*) FROM mrn_line_batches)::text || ' batches, ' ||
      (SELECT COUNT(*) FROM mrn_photos)::text       || ' photos' )::text

  UNION ALL
  SELECT
    '5. MRNs with / without a header delivery no'::text,
    ( (SELECT COUNT(*) FROM mrn WHERE "deliveryNo" IS NOT NULL)::text ||
      ' with, ' ||
      (SELECT COUNT(*) FROM mrn WHERE "deliveryNo" IS NULL)::text ||
      ' without (their lines will backfill to '''')' )::text

  UNION ALL
  -- The backfill cannot violate the new unique index unless this returns rows.
  SELECT
    '6. would the NEW index be violated today?'::text,
    COALESCE(
      (SELECT COUNT(*)::text || ' collisions'
       FROM (
         SELECT l."mrnId", COALESCE(m."deliveryNo", '') AS dly, l."lineNo"
         FROM mrn_lines l JOIN mrn m ON m.id = l."mrnId"
         GROUP BY l."mrnId", COALESCE(m."deliveryNo", ''), l."lineNo"
         HAVING COUNT(*) > 1
       ) dupes),
      '0 collisions')::text
) before_state
ORDER BY item;


-- ============================================================================
-- PART 2 — THE COLUMN
-- ============================================================================
-- 🔴 NOT NULL WITH AN EMPTY-STRING DEFAULT, NOT NULLABLE. This is the decision
-- the whole file turns on.
--
-- The new unique index in Part 5 includes "deliveryNo". In Postgres, NULL is
-- DISTINCT FROM NULL inside a unique index by default — so on a NULLABLE column
-- every line with no delivery number would be unique against every other such
-- line, and (mrnId, NULL, 1) could exist twice. Duplicate line numbers would
-- become possible on exactly the rows least likely to be noticed: the ones with
-- no delivery number at all. That is the guard we are trying to KEEP, not lose.
--
-- '' is the honest "no delivery number" value: it is a real value, it compares
-- equal to itself, and it behaves correctly in a unique index.
--
-- ⚠ A FACTUAL CORRECTION TO THE STEP-2 INSTRUCTION, RECORDED RATHER THAN
-- QUIETLY ACTED ON. The instruction says the Postgres version "decides whether
-- NULLS NOT DISTINCT is available". It is available: this database is
-- PostgreSQL 17.6 (verified 2026-09-01) and NULLS NOT DISTINCT landed in
-- PG 15. So a nullable column WAS technically possible here.
--
-- NOT NULL DEFAULT '' is still the right call, and for a reason the version
-- does not touch:
--   🔴 PRISMA CANNOT EXPRESS `NULLS NOT DISTINCT`. Its @@unique emits a plain
--      unique index, so step 3's schema.prisma would silently describe a
--      DIFFERENT index from the live one, and the next person to trust the
--      schema file would be wrong. This repo hand-mirrors its schema (db push
--      and db pull are both banned/broken — CORE §3), which makes "the file
--      says what the database has" the only defence there is.
--   * A NOT NULL column also removes the null-handling from every read, every
--      groupBy for the tabs, and every comparison in the app.
-- Do not "modernise" this to a nullable column with NULLS NOT DISTINCT.

ALTER TABLE mrn_lines
  ADD COLUMN IF NOT EXISTS "deliveryNo" text NOT NULL DEFAULT '';


-- ============================================================================
-- PART 3 — BACKFILL
-- ============================================================================
-- Copy each MRN's header delivery number down onto its lines. Every existing
-- line lands in exactly ONE group, so every existing MRN renders as a SINGLE
-- tab and nothing looks broken to billing on the morning this ships.
--
-- The three MRNs with a NULL header delivery number (00001, 00003, 00013 —
-- 32 lines between them) all collapse to '' and render as one unnamed tab.
-- That is correct: they genuinely have no delivery number, and inventing one
-- would be worse than showing none.
--
-- ⚠ IDEMPOTENT BY ACCIDENT, NOT BY DESIGN. Re-running this re-copies the same
-- header values over the same rows, which is harmless TODAY — but it becomes
-- destructive the moment step 5 starts writing real per-line delivery numbers,
-- because it would flatten them all back to the legacy header value. This
-- statement has a shelf life. Do not re-run it after step 5 ships.

UPDATE mrn_lines l
SET "deliveryNo" = COALESCE(m."deliveryNo", '')
FROM mrn m
WHERE m.id = l."mrnId";


-- ============================================================================
-- 🔴 PART 4 — DROP THE DEFAULT — COMMENTED OUT. DO NOT RUN IT YET.
-- ============================================================================
--
--   ⛔ THIS STATEMENT MUST NOT RUN UNTIL STEP 5 HAS *DEPLOYED* TO PRODUCTION.
--      Not written. Not committed. DEPLOYED — Vercel builds from origin/main,
--      so a local commit is not enough (CORE §3).
--
-- WHY IT IS COMMENTED OUT RATHER THAN LEFT LIVE
--   app/api/mrn/[mrnId]/lines/route.ts:305 inserts
--   { mrnId, lineNo, skuCode, qtySti, cartonQty } and NOTHING ELSE. Until step
--   5 teaches it to supply "deliveryNo", dropping the default makes every one
--   of those inserts violate NOT NULL.
--
--   🔴 AND IT FAILS *AFTER* THE deleteMany AT :300, SO THE MRN IS LEFT WITH
--   ZERO LINES. That is the whole reason this is commented rather than merely
--   ordered last: a mistake here does not fail safe. Billing pastes a block,
--   the old lines are already gone, the new ones are refused, and the truck is
--   empty on a screen that says only that the save did not work.
--
-- WHAT MAKES IT SAFE TO UNCOMMENT
--   The DEFAULT '' left in place by Part 2 keeps every insert valid in the
--   meantime. Lines written before step 5 land in the unnamed ('') group,
--   which is exactly where the backfill already puts the three MRNs that have
--   no delivery number — so the in-between state is consistent, not corrupt.
--
-- WHERE THE INSTRUCTION TO UNCOMMENT WILL COME FROM
--   🔴 STEP 5 — the per-delivery paste. Its prompt is what will tell you to
--   come back to THIS FILE, uncomment the statement below, and run it on its
--   own. Nothing before step 5 should touch it, and step 5 is not finished
--   until it has been run: while the default stands, a route that forgets to
--   send a delivery number files the lines under '' silently instead of
--   failing, which is the failure this statement exists to prevent.
--
-- HOW TO RUN IT, WHEN THE TIME COMES
--   Select the single ALTER below, delete its two leading dash characters, and
--   run THAT STATEMENT ALONE. Do not re-run the rest of this file: Part 3's
--   backfill would flatten real per-line delivery numbers back to the legacy
--   header value.
--
-- ============================================================================

-- ALTER TABLE mrn_lines ALTER COLUMN "deliveryNo" DROP DEFAULT;


-- ============================================================================
-- PART 5 — THE INDEX SWAP
-- ============================================================================
-- 🔴 THE DROP AND THE CREATE ARE ADJACENT ON PURPOSE. Between them there is no
-- unique index on line numbers at all, and duplicate lineNos could be written
-- with nothing to catch them. The Editor shows only the last result, so a block
-- that dropped and then failed would look no different from one that succeeded.
-- Never run the DROP alone.
--
-- WHY THE KEY CHANGES SHAPE (owner ruling, 2026-09-01): each delivery numbers
-- its lines from 1, so (mrnId, lineNo) is no longer unique — two deliveries on
-- one truck both have a line 1. The delivery number joins the key.
--
-- ⚠ THE STORED lineNo IS NO LONGER A POSITION ON THE TRUCK, and that is the
-- consequence to carry into step 4. The supervisor's phone will show a RUNNING
-- POSITION computed across the whole MRN, not this column. Anything that reads
-- lineNo as "the nth line of this MRN" is now wrong — including the 6a/6b
-- sub-row labels in lib/mrn/report.ts and the "line {lineNo}" captions in the
-- photo UI.
--
-- ⚠ BOTH NEW NAMES ARE PRISMA'S OWN DEFAULTS for the declarations step 3 will
-- write — @@unique([mrnId, deliveryNo, lineNo]) and @@index([mrnId, deliveryNo])
-- — so schema.prisma will need no `map:` and cannot drift. Do not rename them.

DROP INDEX IF EXISTS "mrn_lines_mrnId_lineNo_key";

CREATE UNIQUE INDEX IF NOT EXISTS "mrn_lines_mrnId_deliveryNo_lineNo_key"
  ON mrn_lines ("mrnId", "deliveryNo", "lineNo");

-- Backs the tab grouping: "give me this MRN's lines for delivery X", and the
-- DISTINCT that builds the tab strip itself.
CREATE INDEX IF NOT EXISTS "mrn_lines_mrnId_deliveryNo_idx"
  ON mrn_lines ("mrnId", "deliveryNo");


-- ============================================================================
-- PART 6 — VERIFICATION. This is the result the Editor displays.
--          Every row must read PASS.
-- ============================================================================
-- Each branch is an AGGREGATE with no GROUP BY, so it returns exactly one row
-- even when it finds nothing — a missing object reads as FAIL rather than
-- vanishing from the result and being mistaken for silence.

SELECT * FROM (

  -- ⚠ THE DEFAULT IS EXPECTED TO STILL BE HERE, and this check says so rather
  -- than failing. Part 4 is commented out until step 5 deploys, so `default=''`
  -- is the CORRECT in-between state — a FAIL there would be this file failing
  -- its own instructions and would train the reader to ignore a red row.
  -- The check still fails on the two things that would be genuinely wrong: a
  -- missing column, or a nullable one.
  SELECT
    '01. deliveryNo exists and is NOT NULL'::text AS check_name,
    COALESCE(MAX(data_type || ' · null=' || is_nullable || ' · default=' ||
                 COALESCE(column_default, '(none)')), '(column MISSING)')::text AS detail,
    CASE
      WHEN COUNT(*) = 0 THEN 'FAIL — column missing'
      WHEN MAX(is_nullable) <> 'NO' THEN 'FAIL — must be NOT NULL'
      WHEN MAX(column_default) IS NOT NULL
        THEN 'PASS · default still set — EXPECTED until step 5 (Part 4)'
      ELSE 'PASS · default dropped — step 5 has landed'
    END::text AS result
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'mrn_lines' AND column_name = 'deliveryNo'

  UNION ALL
  SELECT
    '02. every line has a deliveryNo'::text,
    ( COUNT(*)::text || ' lines · ' ||
      COUNT(*) FILTER (WHERE "deliveryNo" <> '')::text || ' named · ' ||
      COUNT(*) FILTER (WHERE "deliveryNo" = '')::text  || ' unnamed ('''')' )::text,
    -- NOT NULL makes a null impossible; this proves the backfill actually ran
    -- rather than leaving every row on the default.
    CASE WHEN COUNT(*) FILTER (WHERE "deliveryNo" IS NULL) = 0 THEN 'PASS'
         ELSE 'FAIL — nulls present' END::text
  FROM mrn_lines

  UNION ALL
  SELECT
    '03. backfill matches each MRN header'::text,
    COUNT(*)::text || ' lines disagree with their MRN header',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL — backfill incomplete' END::text
  FROM mrn_lines l JOIN mrn m ON m.id = l."mrnId"
  WHERE l."deliveryNo" IS DISTINCT FROM COALESCE(m."deliveryNo", '')

  UNION ALL
  SELECT
    '04. old MRN-wide unique index is GONE'::text,
    COALESCE(string_agg(indexname, ', '), '(gone — correct)')::text,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL — still present' END::text
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'mrn_lines'
    AND indexname = 'mrn_lines_mrnId_lineNo_key'

  UNION ALL
  SELECT
    '05. new unique index, named exactly'::text,
    COALESCE(MAX(indexdef), '(MISSING)')::text,
    CASE
      WHEN COUNT(*) = 1 THEN 'PASS'
      -- A lower-cased name here means the DDL was written unquoted: see the
      -- case-folding block at the head of this file.
      WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
                     AND tablename = 'mrn_lines'
                     AND lower(indexname) = 'mrn_lines_mrnid_deliveryno_lineno_key')
        THEN 'FAIL — name was CASE-FOLDED; the DDL left it unquoted'
      ELSE 'FAIL — missing'
    END::text
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'mrn_lines'
    AND indexname = 'mrn_lines_mrnId_deliveryNo_lineNo_key'

  UNION ALL
  SELECT
    '06. new grouping index, named exactly'::text,
    COALESCE(MAX(indexdef), '(MISSING)')::text,
    CASE
      WHEN COUNT(*) = 1 THEN 'PASS'
      WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
                     AND tablename = 'mrn_lines'
                     AND lower(indexname) = 'mrn_lines_mrnid_deliveryno_idx')
        THEN 'FAIL — name was CASE-FOLDED; the DDL left it unquoted'
      ELSE 'FAIL — missing'
    END::text
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'mrn_lines'
    AND indexname = 'mrn_lines_mrnId_deliveryNo_idx'

  UNION ALL
  SELECT
    '07. mrn_lines count UNCHANGED (377)'::text,
    COUNT(*)::text || ' rows',
    CASE WHEN COUNT(*) = 377 THEN 'PASS' ELSE 'FAIL — want 377' END::text
  FROM mrn_lines

  UNION ALL
  SELECT
    '08. one delivery number per MRN today'::text,
    COALESCE(string_agg(mrn_number || '=' || n::text, ', ' ORDER BY mrn_number), '(no rows)')::text,
    -- Every MRN must render as exactly ONE tab after the backfill. More than
    -- one anywhere would mean the backfill did something other than copy the
    -- header down.
    CASE WHEN COUNT(*) FILTER (WHERE n <> 1) = 0 THEN 'PASS'
         ELSE 'FAIL — an MRN has more than one delivery number' END::text
  FROM (
    SELECT m."mrnNumber" AS mrn_number, COUNT(DISTINCT l."deliveryNo")::int AS n
    FROM mrn m JOIN mrn_lines l ON l."mrnId" = m.id
    GROUP BY m.id, m."mrnNumber"
  ) per_mrn

  UNION ALL
  SELECT
    '09. no duplicate (mrnId, deliveryNo, lineNo)'::text,
    COUNT(*)::text || ' collisions',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL — the new index should have refused these' END::text
  FROM (
    SELECT "mrnId", "deliveryNo", "lineNo"
    FROM mrn_lines GROUP BY "mrnId", "deliveryNo", "lineNo" HAVING COUNT(*) > 1
  ) dupes

  UNION ALL
  SELECT
    '10. mrn."deliveryNo" UNTOUCHED (legacy, kept)'::text,
    ( (SELECT COUNT(*) FROM mrn WHERE "deliveryNo" IS NOT NULL)::text || ' of ' ||
      (SELECT COUNT(*) FROM mrn)::text || ' MRNs still carry the header value' )::text,
    CASE WHEN (SELECT COUNT(*) FROM mrn WHERE "deliveryNo" IS NOT NULL) = 10
         THEN 'PASS' ELSE 'FAIL — the header column was modified' END::text

) verification
ORDER BY check_name;


-- ============================================================================
-- AFTER THIS RUNS — STEP 3, in order
-- ============================================================================
--   1. Hand-edit prisma/schema.prisma (db push AND db pull are banned/broken,
--      CORE §3):
--        model mrn_lines
--          + deliveryNo String            -- NOT NULL, NO @default: the default
--                                         -- was dropped in Part 4 on purpose,
--                                         -- so every write must supply it
--          - @@unique([mrnId, lineNo])
--          + @@unique([mrnId, deliveryNo, lineNo])
--          + @@index([mrnId, deliveryNo])
--      Both new names are Prisma's own defaults, so no `map:` is needed.
--   2. `npx prisma generate`
--   3. `npx tsc --noEmit` — this is where the paste route's createMany will
--      FAIL TO COMPILE for want of deliveryNo, which is exactly the signal
--      step 5 exists to answer. Do not silence it with a cast.
--   4. Steps 4-6: the running position on the phone, the per-delivery paste,
--      and billing's tabs.
--   4b. 🔴 WHEN STEP 5 HAS DEPLOYED: come back to this file, uncomment PART 4's
--       single ALTER and run THAT STATEMENT ALONE. Step 5 is not finished until
--       it has been run — while the default stands, a route that forgets to
--       send a delivery number files its lines under '' in silence. Do NOT
--       re-run the rest of the file: Part 3's backfill would flatten real
--       per-line delivery numbers back to the legacy header value.
--   5. Bump the schema stamp in docs/CLAUDE_CORE.md.
-- ============================================================================
