-- ============================================================================
-- 2026-09-15 · Floor trip desk · SLICE 5 — trip numbers are reused after a cancel
--
-- Cancel L-260914-03 → it is renamed L-260914-03-C (then -C2, -C3 …) and the
-- next trip built that day and type takes 03 again. Also fixes the seq-100 bug:
-- the old CHECK used lpad(seq, 2), and Postgres lpad TRUNCATES ('100' → '10').
--
-- Code: lib/trips/number.ts, lib/trips/activity.ts,
--       app/api/floor/trips/route.ts, app/api/floor/trips/[id]/cancel/route.ts
--
-- ── RUN ORDER — EACH STEP IS ITS OWN RUN IN THE SQL EDITOR ──────────────────
--   BEFORE the deploy:  STEP 1 → STEP 2 → STEP 3 → STEP 4
--   THE DEPLOY:         STEP 5 — git push (Vercel builds from origin/main)
--   AFTER the deploy:   STEP 6 → STEP 7
--   Any time after STEP 2: the seq-100 proof at the bottom.
--
-- 🔴 WHY THE CODE MUST NOT DEPLOY BEFORE STEP 4. The new allocator hands out the
-- lowest free seq. A cancelled trip that has not been renamed still holds its
-- TEXT in trips_tripNumber_key, so a create that reuses its seq collides, retries
-- onto the same seq, and fails. Step 4 renames every cancelled trip first.
--
-- 🔴 WHY STEP 6 REPEATS STEP 4. Between Step 4 and the deploy going live, the
-- OLD cancel route is still serving and writes a cancelled trip WITHOUT the -C.
-- Step 6 catches any such trip. It is the same statement and it is idempotent:
-- a trip already carrying a -C suffix is skipped.
--
-- 🔴 WHY STEP 7 IS SEPARATE FROM STEP 2. Step 2 admits a cancelled trip with OR
-- without the suffix, because 51 un-renamed cancelled trips exist when it runs.
-- Step 7 tightens it once none remain: a cancelled trip must carry the suffix,
-- a live trip must not.
--
-- No BEGIN/COMMIT (Supabase SQL Editor). The editor shows only the LAST
-- statement's result, so each step ends with its own check.
-- ============================================================================


-- ============================================================================
-- STEP 1 — BEFORE DEPLOY · the partial unique index replaces the full unique
--
-- Created FIRST, dropped SECOND, so there is never a moment with no uniqueness
-- on the seq. Verified 2026-09-15: zero duplicate (tripDate, typeCode, seq)
-- among non-cancelled trips, so the index builds. 105 rows — a plain CREATE is
-- instant; CONCURRENTLY is not needed.
-- ============================================================================

CREATE UNIQUE INDEX trips_date_type_seq_live_key
  ON trips ("tripDate", "typeCode", seq)
  WHERE status <> 'cancelled';

ALTER TABLE trips DROP CONSTRAINT trips_date_type_seq_key;

-- Check: expect exactly trips_date_type_seq_live_key (partial) and
-- trips_tripNumber_key, and NO trips_date_type_seq_key.
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'trips' AND indexdef ILIKE '%UNIQUE%'
ORDER BY indexname;


-- ============================================================================
-- STEP 2 — BEFORE DEPLOY · the shape CHECK, LENIENT
--
-- A live trip: exactly its number, padded to greatest(2, length) — seq 100 is
-- 'L-260915-100'. A cancelled trip: its number, OR its number + -C / -C2 / -C3.
-- Added under a temporary name first, the old one dropped, then renamed back,
-- so the column is never unguarded. Verified 2026-09-15 against every live row:
-- 0 fail.
-- ============================================================================

ALTER TABLE trips ADD CONSTRAINT chk_trips_number_shape_v2 CHECK (
  "tripNumber" = "typeCode" || '-' || to_char("tripDate", 'YYMMDD') || '-'
                 || lpad(seq::text, greatest(2, length(seq::text)), '0')
  OR (
    status = 'cancelled'
    AND "tripNumber" ~ ('^' || "typeCode" || '-' || to_char("tripDate", 'YYMMDD') || '-'
                       || lpad(seq::text, greatest(2, length(seq::text)), '0')
                       || '-C([2-9]|[1-9][0-9]+)?$')
  )
);

ALTER TABLE trips DROP CONSTRAINT chk_trips_number_shape;

ALTER TABLE trips RENAME CONSTRAINT chk_trips_number_shape_v2 TO chk_trips_number_shape;

-- Check: expect ONE row, chk_trips_number_shape, carrying greatest(2, length…).
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'trips'::regclass AND conname LIKE 'chk_trips_number_shape%';


-- ============================================================================
-- STEP 3 — BEFORE DEPLOY · 'renamed' joins the trip activity vocabulary
--
-- Needed by Step 4's history rows. Reusing 'cancelled' would read as a second
-- cancel. TypeScript twin: TRIP_RENAMED in lib/trips/activity.ts.
-- ============================================================================

ALTER TABLE trip_activity ADD CONSTRAINT chk_trip_activity_action_v2 CHECK (
  action IN ('created', 'bills_added', 'bills_removed', 'vehicle_changed',
             'details_changed', 'cancelled', 'released', 'dispatched', 'renamed')
);

ALTER TABLE trip_activity DROP CONSTRAINT chk_trip_activity_action;

ALTER TABLE trip_activity RENAME CONSTRAINT chk_trip_activity_action_v2 TO chk_trip_activity_action;

-- Check: expect ONE row, and 'renamed' at the end of its list.
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'trip_activity'::regclass AND conname LIKE 'chk_trip_activity_action%';


-- ============================================================================
-- STEP 4 — BEFORE DEPLOY · rename every cancelled trip to <number>-C
--
-- ONE statement: the UPDATE and the history rows commit together or not at all.
-- One trip_activity row per renamed trip, actor user 1, and the summary says
-- plainly that it was the migration and not a person.
--
-- ⚠ ONLY TRIPS WITHOUT A SUFFIX ARE TOUCHED, which is what makes Step 6 safe
-- to run as the same statement.
-- ⚠ '-C' IS ALWAYS FREE HERE. Until the new code deploys, no number has ever
-- been reused, so no <number>-C can already exist (verified 2026-09-15: 0
-- collisions). If that ever stopped being true, the UPDATE would fail on
-- trips_tripNumber_key as a whole — nothing half-done — and 4a shows it first.
-- ============================================================================

-- 4a · PREVIEW (read-only). Expect today: to_rename = 51, name_already_taken = 0.
SELECT
  count(*)::int AS to_rename,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM trips t2 WHERE t2."tripNumber" = c."tripNumber" || '-C'
  ))::int AS name_already_taken
FROM trips c
WHERE c.status = 'cancelled'
  AND c."tripNumber" !~ '-C([2-9]|[1-9][0-9]+)?$';

-- 4b · THE RENAME. Run only after 4a reads name_already_taken = 0.
WITH renamed AS (
  UPDATE trips
     SET "tripNumber" = "tripNumber" || '-C',
         "updatedAt"  = now()
   WHERE status = 'cancelled'
     AND "tripNumber" !~ '-C([2-9]|[1-9][0-9]+)?$'
  RETURNING id, "tripNumber"
)
INSERT INTO trip_activity ("tripId", action, "actorId", summary, detail)
SELECT
  r.id,
  'renamed',
  1,
  'Renamed by the one-off numbering migration, not by a person — was '
    || left(r."tripNumber", length(r."tripNumber") - 2)
    || ', now ' || r."tripNumber",
  jsonb_build_object(
    'was',    left(r."tripNumber", length(r."tripNumber") - 2),
    'now',    r."tripNumber",
    'source', 'sql/2026-09-15-trip-number-reuse.sql'
  )
FROM renamed r;

-- 4c · CHECK. Expect cancelled_without_suffix = 0 and renamed_rows = 51.
SELECT
  (SELECT count(*)::int FROM trips
    WHERE status = 'cancelled' AND "tripNumber" !~ '-C([2-9]|[1-9][0-9]+)?$') AS cancelled_without_suffix,
  (SELECT count(*)::int FROM trip_activity WHERE action = 'renamed')         AS renamed_rows;


-- ============================================================================
-- STEP 5 — THE DEPLOY. Not SQL: push the slice 5 commit. Wait for Vercel to
-- report the build live before Step 6.
-- ============================================================================


-- ============================================================================
-- STEP 6 — AFTER DEPLOY · run STEP 4 AGAIN, all three parts, unchanged
--
-- Catches any trip the OLD cancel route cancelled after Step 4 ran. Expect 4a
-- to read to_rename = 0 (or a handful), 4b to insert that many rows, and 4c to
-- read cancelled_without_suffix = 0. Do not start Step 7 until it does.
-- ============================================================================


-- ============================================================================
-- STEP 7 — AFTER DEPLOY, AFTER STEP 6 · the shape CHECK, STRICT
--
-- A cancelled trip MUST carry the suffix; a live trip must NOT. Adding the
-- constraint validates every existing row, so if Step 6 missed one this fails
-- loudly and changes nothing — re-run Step 6 and try again.
-- ============================================================================

ALTER TABLE trips ADD CONSTRAINT chk_trips_number_shape_v2 CHECK (
  CASE WHEN status = 'cancelled'
    THEN "tripNumber" ~ ('^' || "typeCode" || '-' || to_char("tripDate", 'YYMMDD') || '-'
                        || lpad(seq::text, greatest(2, length(seq::text)), '0')
                        || '-C([2-9]|[1-9][0-9]+)?$')
    ELSE "tripNumber" = "typeCode" || '-' || to_char("tripDate", 'YYMMDD') || '-'
                        || lpad(seq::text, greatest(2, length(seq::text)), '0')
  END
);

ALTER TABLE trips DROP CONSTRAINT chk_trips_number_shape;

ALTER TABLE trips RENAME CONSTRAINT chk_trips_number_shape_v2 TO chk_trips_number_shape;

-- Check: expect ONE row, chk_trips_number_shape, now a CASE.
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'trips'::regclass AND conname LIKE 'chk_trips_number_shape%';


-- ============================================================================
-- SEQ-100 PROOF — any time after STEP 2 · a test date nobody will open
--
-- 2099-12-31 is in the future, so the desk never shows it (a draft is carried
-- onto the desk only from EARLIER days). It writes NO trip_activity row, so the
-- DELETE below is allowed (trip_activity is ON DELETE RESTRICT). Under the OLD
-- CHECK this INSERT was refused: lpad('100', 2, '0') is '10'.
-- ============================================================================

INSERT INTO trips ("tripNumber", "tripDate", "typeCode", "deliveryTypeId", seq, status, "createdById")
VALUES ('L-991231-100', DATE '2099-12-31', 'L', 1, 100, 'draft', 1)
RETURNING id, "tripNumber", seq, status;

-- CLEAN-UP — commented out on purpose. Review the row the INSERT returned, then
-- uncomment and run this alone.
-- DELETE FROM trips WHERE "tripNumber" = 'L-991231-100' AND "tripDate" = DATE '2099-12-31';
