-- ═══════════════════════════════════════════════════════════════════════════
-- Billing · Telephonic tab — step 2 SQL
-- 2026-09-22 · design: docs/prompts/drafts/web-update-2026-09-21-billing-telephonic-tab.md
--
-- Run in the Supabase SQL Editor.  NO transaction wrapper — BEGIN/COMMIT fails
-- silently there (CORE §3).  Plain statements only.  camelCase identifiers
-- quoted, no snake_case columns.
--
-- Re-runnable: tables and indexes are IF NOT EXISTS, the CHECK is DROP IF
-- EXISTS + ADD under the same name, the access fill is ON CONFLICT DO NOTHING.
-- ⚠ IF NOT EXISTS skips a table that already exists WHATEVER its shape — the
-- column counts in PART 5 are what catch a mismatch. Read them.
--
-- Live pre-check (read-only, 2026-09-22): so_tags / so_tag_matches absent,
-- nothing named so_tag% in pg_class, 0 user_page_access rows for
-- 'billing_telephonic', users = 40 (31 active), orders.id and users.id integer.
--
-- Constraint / index names follow Prisma's own defaults ({table}_{col}_fkey,
-- {table}_{cols}_key, {table}_{col}_idx) so step 3's hand-edited schema needs
-- no `map:` — EXCEPT the partial unique index, which Prisma cannot express at
-- all and must be recorded as a comment in the model (same as
-- trips_date_type_seq_live_key, v27.33).
--
-- This file mints a schema version. CORE §7 gets its entry in the same pass
-- as the step-3 schema edit.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- PART 1 — so_tags: the waiting list, one row per SO number typed
-- ───────────────────────────────────────────────────────────────────────────
--
-- status holds only 'waiting' | 'matched'.
-- 🔴 "expired" IS NOT A STORED VALUE. It is DERIVED at read time:
--      status = 'waiting' AND "expiresAt" < now()
-- Storing it would need a job to flip rows at the 15-day mark, and a job that
-- did not run would leave a tag live that the screen calls expired. A derived
-- state cannot drift from the clock.
--
-- expiresAt is set by the add route (addedAt + 15 days), not defaulted here, so
-- the 15 lives in one place in code.

CREATE TABLE IF NOT EXISTS so_tags (
  "id"          SERIAL         NOT NULL,
  "soNumber"    text           NOT NULL,
  "tag"         text           NOT NULL,
  "status"      text           NOT NULL DEFAULT 'waiting',
  "addedById"   integer        NOT NULL,
  "addedAt"     timestamptz(6) NOT NULL DEFAULT now(),
  "matchedAt"   timestamptz(6),
  "expiresAt"   timestamptz(6) NOT NULL,
  "isRemoved"   boolean        NOT NULL DEFAULT false,
  "removedAt"   timestamptz(6),
  "removedById" integer,
  "createdAt"   timestamptz(6) NOT NULL DEFAULT now(),
  -- No trigger: Prisma's @updatedAt advances it on every update (step 3 models
  -- it as @default(now()) @updatedAt, like user_page_access).
  "updatedAt"   timestamptz(6) NOT NULL DEFAULT now(),

  CONSTRAINT so_tags_pkey PRIMARY KEY ("id"),

  CONSTRAINT chk_so_tags_tag    CHECK ("tag"    IN ('hold', 'ci')),
  CONSTRAINT chk_so_tags_status CHECK ("status" IN ('waiting', 'matched')),

  -- RESTRICT: the person who typed the tag is the record of who asked for the
  -- hold / CI — the same rule as ci_returns.supervisorId and mrn.createdById.
  -- Users are deactivated, never deleted; a delete that would orphan this must fail.
  CONSTRAINT "so_tags_addedById_fkey"
    FOREIGN KEY ("addedById") REFERENCES users("id") ON DELETE RESTRICT,

  -- SET NULL: an optional "who removed it" stamp, the same as trips' six
  -- optional actor FKs and ci_returns.voidedById — losing the name must not
  -- block anything, and isRemoved/removedAt still say what happened.
  CONSTRAINT "so_tags_removedById_fkey"
    FOREIGN KEY ("removedById") REFERENCES users("id") ON DELETE SET NULL
);

-- The duplicate backstop. The add route checks first and shows who/when; this
-- catches two operators typing the same SO in the same second. Partial, so a
-- removed tag frees the SO for "remove + re-add" (draft §3, Duplicate).
--
-- It is ALSO the import lookup's index. That query takes a LIVE tag:
--   "soNumber" IN (...) AND "isRemoved" = false
--   AND status IN ('waiting','matched') AND "expiresAt" > now()
-- — waiting OR matched, never waiting only: the first OBD flips a tag to
-- 'matched', and a second OBD on the same SO must still find it. This index
-- answers the soNumber + isRemoved part exactly (same predicate); status and
-- expiresAt are then checked on the handful of rows it returns — at ~33
-- no-mail orders a day the table stays small, so no second index is added.
CREATE UNIQUE INDEX IF NOT EXISTS "so_tags_soNumber_live_key"
  ON so_tags ("soNumber")
  WHERE "isRemoved" = false;


-- ───────────────────────────────────────────────────────────────────────────
-- PART 2 — so_tag_matches: one row per OBD a tag hit
-- ───────────────────────────────────────────────────────────────────────────
--
-- What makes "Held · 2 bills" honest. No CI data here — the tab reads the CI
-- live through the order (ci_returns WHERE orderId AND source =
-- 'auto_bill_only'), the same live-read rule CLAUDE_CI.md §5 applies to the
-- invoice number. ciSkipReason is the one exception: when the auto-CI REFUSES
-- (e.g. a line with no delivered quantity) there is no ci_returns row to read,
-- so the reason has to live somewhere the tab can show it.

CREATE TABLE IF NOT EXISTS so_tag_matches (
  "id"           SERIAL         NOT NULL,
  "soTagId"      integer        NOT NULL,
  "orderId"      integer        NOT NULL,
  "obdNumber"    text           NOT NULL,   -- snapshot, for display without a join
  "appliedAt"    timestamptz(6) NOT NULL DEFAULT now(),
  "ciSkipReason" text,                      -- null unless the auto-CI refused

  CONSTRAINT so_tag_matches_pkey PRIMARY KEY ("id"),

  -- A re-import of the same OBD must never record the match twice. soTagId
  -- leads, so this index also serves "every bill this tag hit".
  CONSTRAINT "so_tag_matches_soTagId_orderId_key" UNIQUE ("soTagId", "orderId"),

  -- RESTRICT on both: nothing in the app deletes these rows or their parents
  -- (tags are soft-removed, orders soft-removed). An accidental delete of a
  -- tag or an order must FAIL, never cascade away the record of what was held.
  CONSTRAINT "so_tag_matches_soTagId_fkey"
    FOREIGN KEY ("soTagId") REFERENCES so_tags("id") ON DELETE RESTRICT,
  CONSTRAINT "so_tag_matches_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES orders("id") ON DELETE RESTRICT
);

-- Supports the orderId FK. Postgres does not index the REFERENCING side of a
-- foreign key, and the UNIQUE above leads with soTagId so it cannot serve an
-- orderId lookup. Without this, every delete on orders would scan this table
-- to enforce the RESTRICT. It also serves any "which tag matched this bill"
-- read, which starts from the order.
CREATE INDEX IF NOT EXISTS "so_tag_matches_orderId_idx"
  ON so_tag_matches ("orderId");


-- ───────────────────────────────────────────────────────────────────────────
-- PART 3 — widen chk_ci_returns_source for the bill-only auto-CI
-- ───────────────────────────────────────────────────────────────────────────
--
-- OLD, read live from pg_constraint 2026-09-22:
--   CHECK ((source = ANY (ARRAY['manual'::text, 'auto_finding'::text])))
-- NEW: adds 'auto_bill_only'. Live rows: manual 48, auto_finding 31 — both
-- still pass, so the ADD validates cleanly.
--
-- ⚠ The code widens with it in step 3 (the Prisma schema step): CiSource in
-- lib/ci/types.ts mirrors this CHECK, and lib/ci/queries.ts narrowed source
-- to 'auto_finding' else 'manual' in two places — an auto_bill_only CI would
-- otherwise display as "manual".

ALTER TABLE ci_returns DROP CONSTRAINT IF EXISTS chk_ci_returns_source;

ALTER TABLE ci_returns
  ADD CONSTRAINT chk_ci_returns_source
  CHECK ("source" IN ('manual', 'auto_finding', 'auto_bill_only'));


-- ───────────────────────────────────────────────────────────────────────────
-- PART 4 — user_page_access: all-false row for 'billing_telephonic', every user
-- ───────────────────────────────────────────────────────────────────────────
--
-- Same shape as sql/2026-09-11-billing-action-ticks.sql: one row per user so
-- /admin/access does not raise its "page rows are missing" banner. All-false
-- and absent mean the same thing to every resolver.
--
-- 🔴 NOBODY IS GRANTED HERE. Smart Flow ticks canView + canEdit on
-- Admin › Access for the billing users. Superusers need no row to see it.
--
-- ON CONFLICT names the REAL constraint user_page_access_user_page_key,
-- UNIQUE ("userId","pageKey") (verified live 2026-09-22). DO NOTHING: a re-run
-- must never lower a tick an admin has since given.

INSERT INTO user_page_access
  ("userId", "pageKey", "canView", "canImport", "canExport", "canEdit", "canDelete")
SELECT
  u.id,
  'billing_telephonic',
  false,   -- canView
  false,   -- canImport
  false,   -- canExport
  false,   -- canEdit
  false    -- canDelete
FROM users u
ON CONFLICT ON CONSTRAINT user_page_access_user_page_key
DO NOTHING;


-- ───────────────────────────────────────────────────────────────────────────
-- PART 5 — verification. ONE SELECT (the editor shows only the last result).
--
-- Expect:
--   so_tags columns 13 · so_tag_matches columns 6
--   every constraint / index row "present"
--   chk_ci_returns_source text includes 'auto_bill_only'
--   billing_telephonic rows = total users (40 on 2026-09-22), granted 0
-- ───────────────────────────────────────────────────────────────────────────

SELECT sort_order, item, value FROM (
  SELECT 1 AS sort_order, 'table so_tags — columns (expect 13)' AS item,
         CASE WHEN to_regclass('public.so_tags') IS NULL THEN 'MISSING'
              ELSE (SELECT count(*) FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'so_tags')::text
         END AS value
  UNION ALL
  SELECT 2, 'table so_tag_matches — columns (expect 6)',
         CASE WHEN to_regclass('public.so_tag_matches') IS NULL THEN 'MISSING'
              ELSE (SELECT count(*) FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'so_tag_matches')::text
         END
  UNION ALL
  SELECT 3, 'constraint ' || c.conname::text || ' (' || c.contype::text || ')',
         pg_get_constraintdef(c.oid)::text
    FROM pg_constraint c
   WHERE c.conname::text IN (
           'so_tags_pkey', 'chk_so_tags_tag', 'chk_so_tags_status',
           'so_tags_addedById_fkey', 'so_tags_removedById_fkey',
           'so_tag_matches_pkey', 'so_tag_matches_soTagId_orderId_key',
           'so_tag_matches_soTagId_fkey', 'so_tag_matches_orderId_fkey')
  UNION ALL
  SELECT 4, 'constraints present (expect 9)',
         (SELECT count(*) FROM pg_constraint c
           WHERE c.conname::text IN (
                   'so_tags_pkey', 'chk_so_tags_tag', 'chk_so_tags_status',
                   'so_tags_addedById_fkey', 'so_tags_removedById_fkey',
                   'so_tag_matches_pkey', 'so_tag_matches_soTagId_orderId_key',
                   'so_tag_matches_soTagId_fkey', 'so_tag_matches_orderId_fkey'))::text
  UNION ALL
  SELECT 5, 'index ' || i.indexname::text, i.indexdef::text
    FROM pg_indexes i
   WHERE i.schemaname = 'public'
     AND i.indexname IN ('so_tags_soNumber_live_key', 'so_tag_matches_orderId_idx')
  UNION ALL
  SELECT 6, 'indexes present (expect 2)',
         (SELECT count(*) FROM pg_indexes i
           WHERE i.schemaname = 'public'
             AND i.indexname IN ('so_tags_soNumber_live_key', 'so_tag_matches_orderId_idx'))::text
  UNION ALL
  SELECT 7, 'chk_ci_returns_source — live text',
         COALESCE((SELECT pg_get_constraintdef(c.oid)::text FROM pg_constraint c
                    WHERE c.conname::text = 'chk_ci_returns_source'
                      AND c.conrelid = 'ci_returns'::regclass), 'MISSING')
  UNION ALL
  SELECT 8, 'billing_telephonic rows / total users / active users',
         (SELECT count(*) FROM user_page_access WHERE "pageKey" = 'billing_telephonic')::text
         || ' / ' || (SELECT count(*) FROM users)::text
         || ' / ' || (SELECT count(*) FROM users WHERE "isActive" = true)::text
  UNION ALL
  SELECT 9, 'billing_telephonic granted (expect 0)',
         (SELECT count(*) FROM user_page_access
           WHERE "pageKey" = 'billing_telephonic'
             AND ("canView" OR "canImport" OR "canExport" OR "canEdit" OR "canDelete"))::text
) v
ORDER BY sort_order, item;
