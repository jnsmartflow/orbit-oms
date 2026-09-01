-- ============================================================================
-- MRN photos + OTR closing step — STEP 1 of 8: SCHEMA ONLY
-- ============================================================================
-- Target      : Supabase SQL Editor (production). Paste and Run as ONE block.
-- Date        : 2026-08-31
-- Schema      : v27.18 -> v27.19 (CLAUDE_CORE.md header owns the stamp; bump it
--               in step 2 together with the prisma/schema.prisma hand-edit)
--
-- WHAT THIS DOES
--   1. Prints the blast radius (run this part ALONE first — see the note below)
--   2. Widens chk_mrn_status from 3 values to 4: adds 'closed'
--   3. Adds mrn."closedAt" and mrn."closedById"  (both NULL, no backfill)
--   4. Creates mrn_photos
--   5. Verifies all of the above in one labelled result
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   * No DELETE, no UPDATE, no DROP TABLE, no data modification of any kind.
--     The ONLY drop is chk_mrn_status in Part 2, re-added two lines later.
--   * No backfill. The 10 existing MRNs stay 'done' and never become 'closed'
--     (verified live 2026-08-31: 10 rows, all status='done', isRemoved=false).
--   * No Storage bucket. The bucket is created BY HAND in the Supabase
--     dashboard — SQL cannot create one and must not pretend to.
--   * No prisma/schema.prisma edit and no `npx prisma generate`. That is step 2.
--     Until step 2 runs, Prisma does not know these columns or this table exist.
--
-- 🔴 IDENTIFIER CASE-FOLDING — THE TRAP THIS FILE ALREADY FELL INTO ONCE
--   Postgres folds every UNQUOTED identifier to lower case. On the real run
--   (2026-09-01) four constraint names were written unquoted, came out
--   lower-cased, and had to be renamed by hand afterwards:
--       CONSTRAINT mrn_photos_storagePath_key   ->  ..._storagepath_key
--       CONSTRAINT mrn_photos_mrnId_fkey        ->  ..._mrnid_fkey
--       CONSTRAINT mrn_photos_lineId_fkey       ->  ..._lineid_fkey
--       CONSTRAINT mrn_photos_capturedById_fkey ->  ..._capturedbyid_fkey
--   They are DOUBLE-QUOTED below so a fresh database reproduces the live
--   camelCase names first time. It matters because Prisma derives its default
--   constraint and index names from the MODEL and COLUMN names — camelCase —
--   so a lower-cased name in the DB is silent drift that surfaces much later
--   as an unexplained `prisma migrate diff` delta.
--
--   ⚠ THE SAFE OPTIONS ARE "QUOTE IT" OR "OMIT IT" — NOT "NAME IT UNQUOTED".
--   Postgres auto-generates a constraint name from the stored COLUMN name, not
--   from your SQL text, so an UNNAMED fk comes out correctly cased. That is
--   exactly why mrn."closedById"'s inline FK in Part 3 — which this file never
--   names — came out as mrn_closedById_fkey, correct, while the three it DID
--   name came out lower-cased. Naming a constraint without quoting it is
--   strictly worse than not naming it at all.
--
--   Unaffected, and why: the CHECK names (chk_*) are all-lowercase already,
--   and the three index names were quoted from the start.
--
-- CORE §3 COMPLIANCE
--   * No BEGIN / COMMIT wrapper.
--   * Every constraint is prefixed `chk_` — `check` is a reserved word.
--   * Every LIMIT inside a UNION ALL is subquery-wrapped (there are none).
--   * No ON CONFLICT (nothing here inserts).
--   * Columns are camelCase and double-quoted. NO @map — @map causes P2022.
--
-- ⚠ THE EDITOR SHOWS ONLY THE LAST STATEMENT'S RESULT.
--   Running the whole file in one paste displays PART 5 ONLY. That is intended:
--   Part 5 is the proof. If you also want to see the BEFORE picture, select and
--   run PART 1 on its own first, then select and run the rest. Parts 2-4 are
--   safe to run twice (IF EXISTS / IF NOT EXISTS throughout).
--
-- ============================================================================
-- 🔴 PROVENANCE — WHY THIS FILE WAS WRITTEN BLIND, AND WHAT RECONCILED IT
-- ============================================================================
-- This file was specified to be written from
--   docs/prompts/drafts/web-update-2026-08-31-mrn-photos-otr.md  (v3)
-- which DID NOT EXIST when it was written on 2026-08-31 — verified three ways
-- (absent from disk, never committed, and no file in the repo containing
-- `mrn_photos` / `storagePath` / `closedById`). The table below was therefore
-- built from the step-1 instruction's column list alone.
--
-- THE DESIGN DOC LANDED 2026-09-01 AND HAS SINCE BEEN READ AGAINST THIS FILE.
-- Its §4.1 matches this table column for column, including bytes NOT NULL,
-- widthPx/heightPx NULLABLE, no updatedAt and no caption column. Two notes:
--   * §4.1 does NOT mention the UNIQUE on "storagePath". That constraint came
--     from the owner's 2026-08-31 amendment to this file and is live. The DB
--     and this file agree; the design doc is simply silent on it.
--   * §4.4 confirms there is NO purge cron and §5.2 that the LR photo is
--     OPTIONAL — both reversed from an earlier draft. Nothing in this file
--     assumes either, so no change was needed.
--
-- The first draft left three judgements open and flagged them `⚠ CHOICE`. ALL
-- THREE WERE PUT TO THE OWNER AND SETTLED ON 2026-09-01, so no CHOICE marker
-- remains — each is now a 🔴 decision comment at its own site:
--   * "widthPx"/"heightPx" -> NULLABLE, "bytes" stays NOT NULL   (Part 4)
--   * "storagePath"        -> UNIQUE, mrn_photos_storagePath_key (Part 4)
--   * "closedById"         -> ON DELETE SET NULL, confirmed kept (Part 3)
-- Those three comments are the record of a decision, not a suggestion to
-- revisit. Anything still genuinely unsettled would carry `⚠ CHOICE`; nothing
-- does.
-- ============================================================================


-- ============================================================================
-- PART 1 — BLAST RADIUS. Nothing below this line changes anything.
--          Select and run this part ON ITS OWN to see the BEFORE state.
-- ============================================================================
SELECT * FROM (
  SELECT
    '1. chk_mrn_status BEFORE'::text                                   AS item,
    COALESCE(MAX(pg_get_constraintdef(con.oid)), '(constraint missing)')::text AS detail
  FROM pg_constraint con
  JOIN pg_class rel     ON rel.oid = con.conrelid
  JOIN pg_namespace n   ON n.oid   = rel.relnamespace
  WHERE n.nspname = 'public' AND rel.relname = 'mrn' AND con.conname = 'chk_mrn_status'

  UNION ALL
  SELECT
    '2. mrn rows by status BEFORE'::text,
    COALESCE(string_agg(status || '=' || n::text, ', ' ORDER BY status), '(no rows)')::text
  FROM (SELECT status, COUNT(*)::int AS n FROM mrn GROUP BY status) s

  UNION ALL
  SELECT
    '3. mrn."closedAt" / "closedById" BEFORE'::text,
    COALESCE(string_agg(column_name, ', ' ORDER BY column_name), '(neither exists — expected)')::text
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'mrn'
    AND column_name IN ('closedAt', 'closedById')

  UNION ALL
  SELECT
    '4. mrn_photos table BEFORE'::text,
    COALESCE(string_agg(table_name, ', '), '(does not exist — expected)')::text
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'mrn_photos'

  UNION ALL
  SELECT
    '5. row counts BEFORE'::text,
    ( (SELECT COUNT(*) FROM mrn)::text              || ' mrn, ' ||
      (SELECT COUNT(*) FROM mrn_lines)::text        || ' mrn_lines, ' ||
      (SELECT COUNT(*) FROM mrn_line_batches)::text || ' mrn_line_batches, ' ||
      (SELECT COUNT(*) FROM users)::text            || ' users' )::text
) before_state
ORDER BY item;


-- ============================================================================
-- PART 2 — WIDEN THE STATUS CHECK: 3 values -> 4
-- ============================================================================
-- Live definition read 2026-08-31 (pg_constraint):
--   CHECK ((status = ANY (ARRAY['open'::text, 'checking'::text, 'done'::text])))
--
-- 🔴 THE DROP AND THE ADD ARE ADJACENT ON PURPOSE. Between these two statements
-- the status column is UNGUARDED — any string would be accepted. The Editor
-- shows only the last result, so a block that ran the DROP and then failed
-- would look no different from one that succeeded. Never run the DROP alone,
-- and never split these two across separate pastes.
--
-- ⚠ lib/mrn/types.ts MUST FOLLOW IN STEP 2. `asMrnStatus()` THROWS on a value
-- it does not recognise (types.ts:38-46) — that is deliberate, so the drift is
-- loud rather than silent. Until MrnStatus gains 'closed', the first MRN moved
-- to 'closed' will throw on every read of the board. Widening the CHECK without
-- widening the union is exactly the failure that guard exists to announce.

ALTER TABLE mrn DROP CONSTRAINT IF EXISTS chk_mrn_status;

ALTER TABLE mrn ADD CONSTRAINT chk_mrn_status
  CHECK (status IN ('open', 'checking', 'done', 'closed'));


-- ============================================================================
-- PART 3 — TWO NEW COLUMNS ON mrn
-- ============================================================================
-- Both NULL, and NOT backfilled. The 10 live MRNs are all 'done' and stay that
-- way: 'closed' is a state trucks enter from here on, never retroactively. A
-- backfilled closedAt would be a timestamp for a closing that never happened.
--
-- 🔴 "closedById" IS ON DELETE SET NULL ON PURPOSE — DO NOT "CORRECT" IT TO
-- RESTRICT. Confirmed by the owner 2026-09-01, after the choice was raised.
-- It matches the three actor FKs mrn already carries: mrn_unloadingStartById_fkey,
-- mrn_unloadingEndById_fkey and mrn_removedById_fkey are ALL SET NULL (read off
-- pg_constraint, live, 2026-08-31). The one RESTRICT on this table is
-- createdById, and prisma/schema.prisma says why in so many words — "an MRN
-- must always know who raised it". Closing is not creation, so it belongs to
-- the SET NULL group. A later session that sees a NULL closer and reasons
-- "evidence must have an actor" will be tempted to tighten this; that would
-- make a departed employee undeletable and put this FK out of step with its
-- three siblings on the same table. The attribution requirement lives on
-- mrn_photos."capturedById" (RESTRICT), which is the row that is actually
-- evidence.

-- The FK rides INLINE on the ADD COLUMN rather than in its own ALTER. Two
-- reasons: ADD CONSTRAINT has no IF NOT EXISTS, so a separate statement would
-- error on a second run, and Postgres auto-names an inline column FK
-- `<table>_<column>_fkey` — i.e. exactly `mrn_closedById_fkey`, which is also
-- Prisma's convention and matches mrn_unloadingStartById_fkey already live. One
-- idempotent statement, no PL/pgSQL block, no name drift for step 2.
ALTER TABLE mrn
  ADD COLUMN IF NOT EXISTS "closedAt"   timestamptz(6) NULL,
  ADD COLUMN IF NOT EXISTS "closedById" integer        NULL
    REFERENCES users(id) ON DELETE SET NULL;


-- ============================================================================
-- PART 4 — mrn_photos
-- ============================================================================
-- ⚠ THE COLUMN LIST COMES FROM THE STEP-1 INSTRUCTION, NOT FROM A DESIGN DOC.
-- See the note at the top of this file. §4.1 could not be consulted.
--
-- 🔴 WHY "lineId" IS ON DELETE CASCADE, AND WHY THAT IS SAFE
-- app/api/mrn/[mrnId]/lines PUT replaces a truck's lines wholesale —
-- `prisma.mrn_lines.deleteMany({ where: { mrnId } })` at route.ts:300 followed
-- by createMany at :305. With CASCADE on "lineId" that deleteMany would take
-- every attached photo with it, silently.
--
-- IT CANNOT HAPPEN, and the reason is a hard gate rather than a convention:
--   * lines PUT 409s unless status === 'open'
--     (app/api/mrn/[mrnId]/lines/route.ts:116-125 — "The supervisor is checking
--     this truck — the lines are locked." / "This MRN is done — the lines can
--     no longer be replaced.")
--   * photos are captured from 'checking' onward — there is no line to attach
--     one to, and no supervisor on the truck, while the MRN is still 'open'.
-- The two windows do not overlap, so no photo can exist at any moment when a
-- lines PUT is legal. The status ladder is one-way (no un-start, no reopen —
-- start/route.ts:14-20, header/route.ts:40), so an MRN cannot fall back to
-- 'open' after photos exist either.
--
-- ⚠ IF A FUTURE SESSION EVER MAKES lines PUT LEGAL AFTER 'open' — a reopen, an
-- un-start, an admin override — THIS CASCADE BECOMES A SILENT PHOTO SHREDDER.
-- Change it to ON DELETE SET NULL in the same commit, or the first reopened
-- truck loses its damage evidence with no error anywhere.
--
-- "mrnId" is CASCADE for the ordinary reason: a deleted MRN's photos are
-- orphans. Note that MRN delete is a SOFT delete (isRemoved), so this fires
-- only on a real row deletion, which nothing in the app currently does.

CREATE TABLE IF NOT EXISTS mrn_photos (
  id             serial         PRIMARY KEY,

  -- The truck. Always present, even on a line-level photo.
  "mrnId"        integer        NOT NULL,

  -- The line, when the photo is about one. NULL means truck-level.
  -- Always NULL for kind='lr' — see chk_mrn_photo_lr_truck_level below.
  "lineId"       integer        NULL,

  -- 🔴 NOT NULL IS LOAD-BEARING, NOT TIDINESS. A CHECK constraint PASSES when
  -- its expression evaluates to NULL. With a nullable `kind`, both CHECKs below
  -- would silently accept a NULL-kind row: `kind IN (...)` is NULL, and
  -- `kind <> 'lr'` is NULL. NOT NULL is what makes the two constraints bite.
  kind           text           NOT NULL,

  -- Path within the Storage bucket (the bucket is created by hand, not here).
  -- UNIQUE — see mrn_photos_storagePath_key at the foot of this table for why.
  "storagePath"  text           NOT NULL,

  -- 🔴 bytes IS NOT NULL AND THE TWO DIMENSIONS ARE NOT. That asymmetry is
  -- deliberate, not an oversight:
  --   * `bytes` is what SIZE ACCOUNTING reads — bucket growth, a per-MRN cap,
  --     and whatever retention job eventually reclaims space. A row that cannot
  --     say how big its object is makes those numbers wrong rather than
  --     incomplete, so every write path must supply it.
  --   * `widthPx` / `heightPx` are CONVENIENCE METADATA — they size a
  --     thumbnail box and stop a gallery reflowing on load. Nothing accounts on
  --     them and nothing breaks without them.
  -- lib/attendance/photo.ts `captureFromVideo()` returns all three
  -- ({ blob, dataUrl, widthPx, heightPx }), so the camera path fills them
  -- anyway. The nullability exists for a FUTURE non-camera path — a file
  -- picker, a forwarded image, a server-side re-encode — which has a byte
  -- count for free but would have to decode the image to learn its dimensions.
  -- Requiring them there would force a decode for a thumbnail hint.
  bytes          integer        NOT NULL,
  "widthPx"      integer        NULL,
  "heightPx"     integer        NULL,

  -- Who took it. NOT NULL and RESTRICT, matching mrn."createdById" — a photo
  -- that is evidence must always know who produced it. Deliberately NOT the
  -- SET NULL treatment the other actor columns get.
  "capturedById" integer        NOT NULL,

  "createdAt"    timestamptz(6) NOT NULL DEFAULT now(),

  -- 🔴 THE CONSTRAINT NAMES ARE DOUBLE-QUOTED. See the case-folding trap at the
  -- head of this file. Unquoted, these three folded to mrn_photos_mrnid_fkey /
  -- _lineid_fkey / _capturedbyid_fkey on the real run and were renamed by hand.
  CONSTRAINT "mrn_photos_mrnId_fkey"
    FOREIGN KEY ("mrnId")        REFERENCES mrn(id)       ON DELETE CASCADE,
  CONSTRAINT "mrn_photos_lineId_fkey"
    FOREIGN KEY ("lineId")       REFERENCES mrn_lines(id) ON DELETE CASCADE,
  CONSTRAINT "mrn_photos_capturedById_fkey"
    FOREIGN KEY ("capturedById") REFERENCES users(id)     ON DELETE RESTRICT,

  -- The closed vocabulary. Widening it is an ALTER here FIRST, then the TS
  -- union — the same rule chk_mrn_status and chk_mrn_received_from live under.
  CONSTRAINT chk_mrn_photo_kind
    CHECK (kind IN ('lr', 'leaky', 'damage', 'other')),

  -- An LR photo is a TRUCK-level fact — the lorry receipt covers the whole
  -- consignment, not one SKU — so it may never carry a line.
  -- Reads as: "if this is an LR photo, lineId must be NULL."
  -- The other three kinds are unconstrained: they may be line-level or
  -- truck-level as the operator finds them.
  CONSTRAINT chk_mrn_photo_lr_truck_level
    CHECK (kind <> 'lr' OR "lineId" IS NULL),

  -- 🔴 ONE ROW PER STORAGE OBJECT. Two rows pointing at the same object is a
  -- delete that half-works: removing either row orphans the other, which then
  -- renders a broken image, or — worse, in the order it actually happens — the
  -- delete path removes the object from the bucket while a second row still
  -- claims it. The row that survives looks intact in the DB and 404s in the
  -- browser, and nothing in Postgres or the app reports it.
  -- The DB is the only place that can make that unrepresentable, so it does.
  -- Named `_key` per the live convention this file already follows —
  -- mrn_mrnNumber_key, mrn_lines_mrnId_lineNo_key,
  -- mrn_line_batches_lineId_batchNo_key — so step 2's `@unique` in
  -- schema.prisma generates the identical name and produces no drift.
  CONSTRAINT "mrn_photos_storagePath_key" UNIQUE ("storagePath")
);

-- Index names follow Prisma's own convention (<table>_<cols>_idx), matching
-- mrn_status_idx and mrn_lines_mrnId_lineNo_key already live, so step 2's
-- hand-edit of schema.prisma + `npx prisma generate` produces no drift.
CREATE INDEX IF NOT EXISTS "mrn_photos_mrnId_idx"      ON mrn_photos ("mrnId");
CREATE INDEX IF NOT EXISTS "mrn_photos_mrnId_kind_idx" ON mrn_photos ("mrnId", kind);
CREATE INDEX IF NOT EXISTS "mrn_photos_lineId_idx"     ON mrn_photos ("lineId");


-- ============================================================================
-- PART 5 — VERIFICATION. This is the result the Editor displays.
--          Every row must read PASS.
-- ============================================================================
-- Each branch is an AGGREGATE with no GROUP BY, so it returns exactly one row
-- even when it finds nothing — a missing object reads as FAIL rather than
-- vanishing from the result and being mistaken for silence.

SELECT * FROM (

  SELECT
    '01. chk_mrn_status allows 4 values'::text AS check_name,
    COALESCE(MAX(pg_get_constraintdef(con.oid)), '(constraint MISSING)')::text AS detail,
    CASE WHEN MAX(pg_get_constraintdef(con.oid)) LIKE '%closed%'
         THEN 'PASS' ELSE 'FAIL' END::text AS result
  FROM pg_constraint con
  JOIN pg_class rel   ON rel.oid = con.conrelid
  JOIN pg_namespace n ON n.oid   = rel.relnamespace
  WHERE n.nspname = 'public' AND rel.relname = 'mrn' AND con.conname = 'chk_mrn_status'

  UNION ALL
  SELECT
    '02. mrn has closedAt + closedById'::text,
    COALESCE(string_agg(column_name || ' ' || data_type || ' (null=' || is_nullable || ')',
                        ', ' ORDER BY column_name), '(neither exists)')::text,
    CASE WHEN COUNT(*) = 2 THEN 'PASS' ELSE 'FAIL — want 2' END::text
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'mrn'
    AND column_name IN ('closedAt', 'closedById')

  UNION ALL
  SELECT
    '03. mrn_photos exists, 10 cols, bytes NOT NULL, dims NULL'::text,
    COALESCE(string_agg(column_name || CASE WHEN is_nullable = 'YES' THEN '?' ELSE '' END,
                        ', ' ORDER BY ordinal_position), '(table MISSING)')::text,
    CASE
      WHEN COUNT(*) <> 10 THEN 'FAIL — want 10 cols, got ' || COUNT(*)::text
      WHEN COUNT(*) FILTER (WHERE column_name = 'bytes'    AND is_nullable = 'NO')  <> 1
        THEN 'FAIL — bytes must be NOT NULL'
      WHEN COUNT(*) FILTER (WHERE column_name IN ('widthPx','heightPx')
                              AND is_nullable = 'YES')                             <> 2
        THEN 'FAIL — widthPx/heightPx must be NULLABLE'
      WHEN COUNT(*) FILTER (WHERE column_name = 'kind'     AND is_nullable = 'NO')  <> 1
        THEN 'FAIL — kind must be NOT NULL (both CHECKs depend on it)'
      ELSE 'PASS'
    END::text
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'mrn_photos'

  UNION ALL
  SELECT
    '04. both mrn_photos CHECKs exist'::text,
    COALESCE(string_agg(con.conname, ', ' ORDER BY con.conname), '(none)')::text,
    CASE WHEN COUNT(*) = 2 THEN 'PASS' ELSE 'FAIL — want 2' END::text
  FROM pg_constraint con
  JOIN pg_class rel   ON rel.oid = con.conrelid
  JOIN pg_namespace n ON n.oid   = rel.relnamespace
  WHERE n.nspname = 'public' AND rel.relname = 'mrn_photos' AND con.contype = 'c'
    AND con.conname IN ('chk_mrn_photo_kind', 'chk_mrn_photo_lr_truck_level')

  UNION ALL
  SELECT
    '05. storagePath UNIQUE, named exactly'::text,
    COALESCE(string_agg(con.conname || ' ' || pg_get_constraintdef(con.oid),
                        ' | ' ORDER BY con.conname), '(no UNIQUE at all)')::text,
    CASE
      WHEN COUNT(*) FILTER (WHERE con.conname = 'mrn_photos_storagePath_key') = 1
        THEN 'PASS'
      WHEN COUNT(*) FILTER (WHERE lower(con.conname) = 'mrn_photos_storagepath_key') = 1
        THEN 'FAIL — name was CASE-FOLDED; the DDL left it unquoted'
      ELSE 'FAIL — no UNIQUE on storagePath'
    END::text
  -- 🔴 DELIBERATELY NOT FILTERED BY NAME. The first version of this check
  -- matched on the exact name in its WHERE, so when the real run produced the
  -- folded 'mrn_photos_storagepath_key' the detail column read "(MISSING)" and
  -- sent the reader hunting for a constraint that was in fact right there under
  -- the wrong name. A check must show what IS there, then judge it.
  FROM pg_constraint con
  JOIN pg_class rel   ON rel.oid = con.conrelid
  JOIN pg_namespace n ON n.oid   = rel.relnamespace
  WHERE n.nspname = 'public' AND rel.relname = 'mrn_photos' AND con.contype = 'u'

  UNION ALL
  SELECT
    '06. all three mrn_photos indexes'::text,
    COALESCE(string_agg(indexname, ', ' ORDER BY indexname), '(none)')::text,
    CASE WHEN COUNT(*) = 3 THEN 'PASS' ELSE 'FAIL — want 3' END::text
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'mrn_photos'
    AND indexname IN ('mrn_photos_mrnId_idx', 'mrn_photos_mrnId_kind_idx', 'mrn_photos_lineId_idx')

  UNION ALL
  SELECT
    '07. all three mrn_photos FKs, named exactly'::text,
    COALESCE(string_agg(con.conname || ' ' || pg_get_constraintdef(con.oid),
                        ' | ' ORDER BY con.conname), '(none)')::text,
    -- 🔴 THIS CHECK USED TO COUNT TO THREE AND NOTHING ELSE, so on the real run
    -- it PASSED while all three FKs carried case-folded names. Counting proves
    -- the constraints exist; only matching the names proves they are the ones
    -- Prisma will expect. That miss is why the fold reached production.
    CASE
      WHEN COUNT(*) FILTER (WHERE con.conname IN ('mrn_photos_mrnId_fkey',
                                                  'mrn_photos_lineId_fkey',
                                                  'mrn_photos_capturedById_fkey')) = 3
        THEN 'PASS'
      WHEN COUNT(*) = 3
        THEN 'FAIL — 3 FKs but WRONG NAMES (case-folded?); see detail'
      ELSE 'FAIL — want 3, got ' || COUNT(*)::text
    END::text
  FROM pg_constraint con
  JOIN pg_class rel   ON rel.oid = con.conrelid
  JOIN pg_namespace n ON n.oid   = rel.relnamespace
  WHERE n.nspname = 'public' AND rel.relname = 'mrn_photos' AND con.contype = 'f'

  UNION ALL
  SELECT
    '08. MRN counts UNCHANGED (10 done, 0 closed)'::text,
    COALESCE(string_agg(status || '=' || n::text, ', ' ORDER BY status), '(no rows)')::text,
    CASE WHEN SUM(n) = 10
           AND COALESCE(SUM(n) FILTER (WHERE status = 'closed'), 0) = 0
         THEN 'PASS' ELSE 'FAIL — rows changed' END::text
  FROM (SELECT status, COUNT(*)::int AS n FROM mrn GROUP BY status) s

  UNION ALL
  SELECT
    '09. mrn_lines UNCHANGED (344)'::text,
    COUNT(*)::text || ' rows',
    CASE WHEN COUNT(*) = 344 THEN 'PASS' ELSE 'FAIL — want 344' END::text
  FROM mrn_lines

  UNION ALL
  SELECT
    '10. mrn_photos is empty'::text,
    COUNT(*)::text || ' rows',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL — this step inserts nothing' END::text
  FROM mrn_photos

) verification
ORDER BY check_name;


-- ============================================================================
-- AFTER THIS RUNS — STEP 2, in order
-- ============================================================================
--   1. Hand-edit prisma/schema.prisma (db push AND db pull are banned, CORE §3):
--        model mrn        + closedAt DateTime? @db.Timestamptz(6)
--                         + closedById Int?  and a NAMED relation to users
--        model mrn_photos (new)
--        model users      + the matching back-relations
--      🔴 users is ALREADY the target of four named mrn relations
--      (MrnUnloadingStartedBy / MrnUnloadingEndedBy / MrnRemovedBy /
--      MrnCreatedBy). A fifth FK from mrn to users, and the new one from
--      mrn_photos, MUST each carry an explicit @relation("Name") on BOTH sides
--      or Prisma fails to generate — the ambiguity trap, not a warning.
--   2. `npx prisma generate`
--   3. Widen MrnStatus in lib/mrn/types.ts to include 'closed' — see the
--      warning in Part 2. Nothing reads 'closed' safely until this lands.
--   4. `npx tsc --noEmit` must pass before any commit.
--   5. Create the Storage bucket BY HAND in the Supabase dashboard.
--   6. Bump the schema stamp in docs/CLAUDE_CORE.md (v27.18 -> v27.19).
-- ============================================================================
