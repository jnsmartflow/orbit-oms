-- ═══════════════════════════════════════════════════════════════════════════
-- app_tag_settings — scope columns (everyone / role / user)
-- 2026-09-11 · Phase 1 of the hide-switch scoping work · BADGES AND BANDS ONLY
--
-- Run in the Supabase SQL Editor.  NO transaction wrapper — BEGIN/COMMIT fails
-- silently there (CORE §3).  Plain statements only.  camelCase identifiers
-- quoted.  Every statement is idempotent: running the file twice is a no-op.
--
-- WHAT THIS DOES.  Teaches the tag-switch table WHO a switch applies to.  Today
-- one row per tagKey means "everybody".  After this, a row also carries a scope:
--
--     everyone → "roleSlug" NULL, "userId" NULL      ← what all 3 live rows become
--     role     → "roleSlug" set,  "userId" NULL
--     user     → "roleSlug" NULL, "userId" set
--
-- Resolution (owner-locked 2026-09-11, implemented in code not here):
--   user row wins → else role rows → else the everyone row → else SHOWN.
--   Multi-role: a role-level hide applies only if EVERY role the user holds
--   hides it.  Show wins.  No admin/superuser bypass for badges.
--
-- 🔴 DEFAULT-ON IS PRESERVED BY CONSTRUCTION.  No rows ≡ every badge shows.
-- The 3 live rows (owner SELECT 2026-09-11: 3 rows, 0 with isEnabled=false)
-- inherit scope='everyone' from the column DEFAULT, so they keep meaning exactly
-- what they mean today.  No UPDATE is needed and none is written — the column is
-- NOT NULL DEFAULT 'everyone', so there is no row it could miss.
--
-- ── WHY "roleSlug" TEXT AND NOT A ROLE ID ──────────────────────────────────
--
-- The live access code identifies a role by its SLUG, everywhere:
--
--   lib/auth.ts:217-221   the session carries `roles` as slugified names —
--                         role_master.name lowercased, whitespace → "_"
--   prisma/schema.prisma:99   role_permissions."roleSlug" is TEXT
--   lib/permissions.ts:579    checkAnyPermission(roleSlugs, …) takes slugs
--   lib/rbac.ts:110           the admin arm tests roles.includes("admin")
--
-- The resolver for these switches runs on GET /api/mail-orders, which already
-- holds the session.  With slugs it needs ZERO extra queries — session.user.roles
-- goes straight into the WHERE.  With a role id it would need a per-request
-- lookup on the hottest read path in the app (that route is polled by every open
-- board).  Matching role_permissions also means one mental model for "how a role
-- is named in this database", not two.
--
-- ⚠ THE COST, STATED: a slug has no foreign key, so renaming a role in
-- role_master silently orphans any role-scoped row pointing at the old slug.
-- There is nothing to FK TO — the slug is DERIVED from role_master.name
-- (lowercased, spaces replaced), not stored anywhere.  role_permissions has
-- carried exactly this risk for its whole life.  The orphan fails SAFE: an
-- unmatched roleSlug matches no user, so the switch stops applying and the badge
-- SHOWS.  A rename is an admin action that already requires care.
--
-- ⚠ REGEX TRAP, if any future backfill derives slugs in SQL: in this database
-- regexp_replace(name, '\s+', '_', 'g') matches a LITERAL "s", not whitespace.
-- Use '[[:space:]]+'.  (sql/2026-09-04-user-page-access.sql documents the seven
-- slugs it mangled.)  This file derives nothing, so the trap is not live here.
--
-- ── RUN ORDER — READ BEFORE PASTING ────────────────────────────────────────
--
-- PARTS 1-3 ARE SAFE TO RUN AT ANY TIME, BEFORE OR AFTER THE CODE DEPLOYS.
-- They are purely additive: the current Tags save and the current read both keep
-- working, because the old UNIQUE("tagKey") is still there.
--
-- 🔴 PART 4 IS THE ONLY STATEMENT THAT BREAKS ANYTHING.  Dropping the old
-- UNIQUE removes the ON CONFLICT target that today's Prisma upsert depends on
-- (app/api/admin/tag-settings/route.ts:61-65), so between PART 4 and the code
-- deploy the Tags tab CANNOT SAVE — it 500s.  Reads are unaffected.
--
-- Two ways to run this, both correct:
--   (a) ONE PASTE, small window.  Run the whole file, then deploy.  Do not touch
--       Settings › Hide › Tags in between.  Fine for a quiet moment.
--   (b) ZERO WINDOW.  Run PARTS 1-3 now.  Deploy the phase-1 code.  Then come
--       back and run PART 4 alone.  Scoped rows cannot be written until PART 4
--       has run, so the admin must not add exceptions before it.
--
-- Deploying the code FIRST, against the un-altered table, is the ONE order that
-- must not be used: the new resolver selects "scope"/"roleSlug"/"userId", so
-- every read throws P2022 on a route every open board polls.  See the gate
-- report in docs/prompts/drafts/.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- PART 1 — the three columns
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE app_tag_settings
  ADD COLUMN IF NOT EXISTS "scope"    TEXT NOT NULL DEFAULT 'everyone',
  ADD COLUMN IF NOT EXISTS "roleSlug" TEXT,
  ADD COLUMN IF NOT EXISTS "userId"   INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- ON DELETE CASCADE on "userId": a user-scoped switch is meaningless once the
-- person is gone, and leaving the row would let a recycled id inherit somebody
-- else's hidden badges.  Matches user_page_access."userId" (CORE §7.14).
-- There is no such clause for "roleSlug" because there is no FK — see the header.


-- ───────────────────────────────────────────────────────────────────────────
-- PART 2 — the shape guard
--
-- Named chk_ because "check" is reserved.  This is what stops a half-filled row
-- — scope='user' with no userId, or scope='everyone' carrying a stale roleSlug —
-- from reaching the resolver, where it would silently match nobody and look like
-- a switch that does not work.
-- ───────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'app_tag_settings'::regclass
       AND conname  = 'chk_app_tag_settings_scope'
  ) THEN
    ALTER TABLE app_tag_settings
      ADD CONSTRAINT chk_app_tag_settings_scope CHECK (
        ("scope" = 'everyone' AND "roleSlug" IS NULL     AND "userId" IS NULL) OR
        ("scope" = 'role'     AND "roleSlug" IS NOT NULL AND "userId" IS NULL) OR
        ("scope" = 'user'     AND "roleSlug" IS NULL     AND "userId" IS NOT NULL)
      );
    RAISE NOTICE 'added chk_app_tag_settings_scope';
  ELSE
    RAISE NOTICE 'chk_app_tag_settings_scope already present — skipped';
  END IF;
END $$;


-- ───────────────────────────────────────────────────────────────────────────
-- PART 3 — THREE partial unique indexes, one per scope
--
-- 🔴 WHY THREE, AND NOT ONE COMPOSITE.  In Postgres NULLs are DISTINCT for
-- uniqueness, so UNIQUE ("tagKey","roleSlug","userId") would happily accept TWO
-- 'everyone' rows for the same tag — both have NULL,NULL — and the resolver
-- would then return whichever the planner felt like.  That bug appears months
-- later, intermittently, on one tag.  A partial index per scope has no NULLs in
-- its key and cannot do it.
--
-- Created BEFORE the old UNIQUE is dropped so the table is never unprotected.
-- ───────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS app_tag_settings_everyone_key
  ON app_tag_settings ("tagKey")
  WHERE "scope" = 'everyone';

CREATE UNIQUE INDEX IF NOT EXISTS app_tag_settings_role_key
  ON app_tag_settings ("tagKey", "roleSlug")
  WHERE "scope" = 'role';

CREATE UNIQUE INDEX IF NOT EXISTS app_tag_settings_user_key
  ON app_tag_settings ("tagKey", "userId")
  WHERE "scope" = 'user';

-- Lookup indexes for the resolver's OR-arms.  The three uniques above lead with
-- "tagKey", which is the wrong leading column for "everything that applies to
-- THIS person" — the query the mail-orders route runs on every poll.
CREATE INDEX IF NOT EXISTS app_tag_settings_user_idx
  ON app_tag_settings ("userId")   WHERE "userId"   IS NOT NULL;

CREATE INDEX IF NOT EXISTS app_tag_settings_role_idx
  ON app_tag_settings ("roleSlug") WHERE "roleSlug" IS NOT NULL;


-- ───────────────────────────────────────────────────────────────────────────
-- PART 4 — drop the old single-column UNIQUE ("tagKey")
--
-- 🔴 THIS IS THE STATEMENT WITH A BLAST RADIUS.  Until the phase-1 code is
-- deployed, saving a tag from Settings › Hide › Tags will 500: today's route
-- upserts on `where: { tagKey }` (app/api/admin/tag-settings/route.ts:61-65) and
-- Prisma's native upsert emits ON CONFLICT ("tagKey"), which Postgres rejects
-- with 42P10 once no matching constraint exists.  Reads are NOT affected —
-- getTagSettings() is an unfiltered findMany (lib/hide/tag-settings.ts:12-21).
--
-- It must go eventually: while it stands, a tag can have only ONE row, so no
-- role or user exception can ever be inserted.
--
-- Located by its KEY COLUMNS, not by name — the auto-generated name preserves
-- the column's camelCase ("app_tag_settings_tagKey_key") and a hand-made one
-- would not match a guess.  Idempotent: nothing to drop is a NOTICE, not an
-- error.
-- ───────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  c_name text;
BEGIN
  SELECT c.conname INTO c_name
    FROM pg_constraint c
   WHERE c.conrelid = 'app_tag_settings'::regclass
     AND c.contype  = 'u'
     AND c.conkey   = ARRAY[
           (SELECT a.attnum
              FROM pg_attribute a
             WHERE a.attrelid = 'app_tag_settings'::regclass
               AND a.attname  = 'tagKey')
         ]::smallint[];

  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE app_tag_settings DROP CONSTRAINT %I', c_name);
    RAISE NOTICE 'dropped single-column UNIQUE on "tagKey": %', c_name;
  ELSE
    RAISE NOTICE 'no single-column UNIQUE on "tagKey" — already dropped, nothing to do';
  END IF;
END $$;


-- ───────────────────────────────────────────────────────────────────────────
-- PART 5 — verification.  ONE SELECT, because the Supabase editor shows only
-- the LAST statement's result.  Read it top to bottom:
--
--   ROWS       every existing row, each of which must say scope=everyone
--   COUNT      rows per scope (expect: everyone = 3, nothing else, today)
--   COLUMN     the three new columns (expect 3 lines)
--   CHECK      the shape guard (expect 1 line)
--   INDEX      the partial uniques (expect 3 lines)
--   OLD-UNIQUE expect ZERO lines.  Any line here means PART 4 did not run, and
--              exceptions cannot be saved yet.
-- ───────────────────────────────────────────────────────────────────────────

SELECT 1 AS sort_order,
       'ROWS'                                  AS line_type,
       "tagKey"                                AS subject,
       "scope" || ' · isEnabled=' || "isEnabled"::text AS detail
  FROM app_tag_settings
UNION ALL
SELECT 2,
       'COUNT',
       'rows with scope = ' || "scope",
       count(*)::text
  FROM app_tag_settings
 GROUP BY "scope"
UNION ALL
SELECT 3,
       'COLUMN',
       column_name,
       data_type || CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE ' NULL' END
  FROM information_schema.columns
 WHERE table_name  = 'app_tag_settings'
   AND column_name IN ('scope', 'roleSlug', 'userId')
UNION ALL
SELECT 4,
       'CHECK',
       conname,
       'present'
  FROM pg_constraint
 WHERE conrelid = 'app_tag_settings'::regclass
   AND conname  = 'chk_app_tag_settings_scope'
UNION ALL
SELECT 5,
       'INDEX',
       indexname,
       'present'
  FROM pg_indexes
 WHERE tablename = 'app_tag_settings'
   AND indexname IN ('app_tag_settings_everyone_key',
                     'app_tag_settings_role_key',
                     'app_tag_settings_user_key')
UNION ALL
SELECT 6,
       'OLD-UNIQUE',
       conname,
       'STILL PRESENT — PART 4 has not run; exceptions cannot be saved yet'
  FROM pg_constraint
 WHERE conrelid = 'app_tag_settings'::regclass
   AND contype  = 'u'
 ORDER BY sort_order, subject;
