-- ============================================================================
-- sql/2026-11-04-v27.80-stock-audit-line-client-id.sql
-- 2026-11-04 · Stock count OFFLINE QUEUE — two nullable columns on
-- stock_audit_lines: "clientId" (the phone's per-entry id) and "countedAt"
-- (the phone's clock at Submit).
--
-- Planned Schema v27.80. Live is v27.79 (verified by read-only SELECT on
-- 2026-11-04: stock_audit_lines has "qty", stock_audit_counters is gone,
-- stock_audits_one_open_key exists; stock_audit_lines 12 columns ·
-- 7 constraints · 5 indexes · 10 lines). CORE's header still reads v27.78 —
-- stale, to be corrected in the CORE update that mints v27.80.
-- RUN 2026-11-04 — read-back clean: 14 · 8 · 6, lines unchanged
-- (The version was minted only after the owner ran this file and the
-- read-back (section 4) came back with no MISSING row and
-- "lines unchanged" = yes.) Prisma is hand-edited to match, never
-- `db push` / `db pull` (CORE §3).
--
-- ── DECISION (Smart Flow, 2026-11-04) ───────────────────────────────────────
--   Parts of the warehouse have no or weak signal. Submit saves the entry ON
--   THE PHONE first (localStorage queue) and a background sender posts it
--   when the network allows. A send can reach the server and lose its reply,
--   so the phone retries — and must never create a second line.
--
--   1. "clientId" uuid NULL + CONSTRAINT stock_audit_lines_clientId_key
--      UNIQUE ("clientId").
--      A UUID the phone generates once per entry. POST /api/stock-count/
--      audits/[id]/lines with a clientId already stored returns the EXISTING
--      line (idempotent) instead of inserting. A plain UNIQUE, not a partial
--      index: NULLs are distinct in Postgres, so the existing rows (all NULL)
--      never collide, and Prisma can model a plain UNIQUE (@unique).
--   2. "countedAt" timestamptz(6) NULL.
--      The phone's clock when the counter tapped Submit — an entry counted at
--      9:05 offline may only arrive at 9:40 (createdAt). Shown on the desk
--      ledger; NULL on existing rows, where the screen falls back to
--      createdAt. NO CHECK — phone clocks can be off, and a wrong clock must
--      never refuse a count.
--   No other change. No trigger. No backfill. No row is touched.
--
-- ── PURELY ADDITIVE ─────────────────────────────────────────────────────────
--   Old code never names these columns (every write lists its columns; every
--   read is a Prisma select), so THIS SQL CAN RUN BEFORE THE CODE DEPLOYS —
--   the reverse of v27.79. Live screens keep working between the run and the
--   push.
--
-- ── HOW TO RUN (Smart Flow, Supabase SQL Editor) ─────────────────────────────
--   The whole file in ONE paste, top to bottom. No BEGIN/COMMIT (CORE §3). The
--   editor shows only the LAST result — the read-back.
--   🔴 SINGLE-RUN FILE. Section 2 REFUSES the paste (nothing changed) unless
--   stock_audit_lines is in its v27.79 shape — so a second paste stops at
--   once. The editor runs a paste as one implicit transaction, so a failure
--   part-way normally leaves NOTHING behind — confirm by pasting the section 2
--   DO block alone (read-only: it only checks and prints): it must pass again.
--   (Section 4 cannot run alone in a new session: its "lines unchanged" row
--   reads section 2's temp snapshot.)
--   Never with session_replication_role = replica (CORE §13).
-- ============================================================================


-- ============================================================================
-- 1. TIMEOUT (the postgres role's statement_timeout is 30s).
-- ============================================================================

SET statement_timeout = 0;


-- ============================================================================
-- 2. GUARD — the v27.79 shape, or stop. Also prints the line count.
--   Refuses when: stock_audit_lines is missing · it has no "qty" (v27.79 not
--   run) · it already has "clientId" or "countedAt" · the constraint or index
--   stock_audit_lines_clientId_key already exists.
-- ============================================================================

DO $$
DECLARE
  v_problems text := '';
  v_lines    bigint;
BEGIN
  IF to_regclass('public.stock_audit_lines') IS NULL THEN
    RAISE EXCEPTION 'stock audit v27.80: stock_audit_lines missing. Nothing was changed.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'stock_audit_lines' AND column_name = 'qty') THEN
    v_problems := v_problems || ' · stock_audit_lines has no "qty" (v27.79 not run?)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'stock_audit_lines' AND column_name = 'clientId') THEN
    v_problems := v_problems || ' · stock_audit_lines already has "clientId"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'stock_audit_lines' AND column_name = 'countedAt') THEN
    v_problems := v_problems || ' · stock_audit_lines already has "countedAt"';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint k JOIN pg_namespace n ON n.oid = k.connamespace
              WHERE n.nspname = 'public' AND k.conname = 'stock_audit_lines_clientId_key') THEN
    v_problems := v_problems || ' · constraint stock_audit_lines_clientId_key already exists';
  END IF;
  IF to_regclass('public."stock_audit_lines_clientId_key"') IS NOT NULL THEN
    v_problems := v_problems || ' · relation stock_audit_lines_clientId_key already exists';
  END IF;

  IF v_problems <> '' THEN
    RAISE EXCEPTION 'stock audit v27.80: not in the v27.79 shape (already run?):%. Nothing was changed.', v_problems;
  END IF;

  SELECT count(*) INTO v_lines FROM stock_audit_lines;
  RAISE NOTICE 'stock audit v27.80 — before: stock_audit_lines % rows (no row is changed)', v_lines;
END
$$;

-- The "before" snapshot, for the read-back (notices are easy to miss in the
-- editor). A session temp table: it vanishes when the editor's session ends.
DROP TABLE IF EXISTS pg_temp.sa_v2780_before;
CREATE TEMP TABLE sa_v2780_before AS
  SELECT count(*)::bigint AS n,
         COALESCE(sum("qty"), 0)::bigint AS pcs
    FROM stock_audit_lines;


-- ============================================================================
-- 3. THE TWO COLUMNS + THE UNIQUE.
--   Both NULL, no DEFAULT — existing rows stay NULL, nothing is rewritten.
--   The UNIQUE constraint builds its own index of the same name
--   (stock_audit_lines_clientId_key) over 10 test rows — instant.
-- ============================================================================

ALTER TABLE stock_audit_lines ADD COLUMN "clientId"  uuid NULL;
ALTER TABLE stock_audit_lines ADD COLUMN "countedAt" timestamptz(6) NULL;

ALTER TABLE stock_audit_lines
  ADD CONSTRAINT "stock_audit_lines_clientId_key" UNIQUE ("clientId");


-- ============================================================================
-- 4. READ-BACK — READ-ONLY, the last statement (the one the editor shows).
-- Expect, with NO 'MISSING' row:
--   before / after         stock_audit_lines 10 rows (as of the 2026-11-04
--                          read; if test lines were added since, the two
--                          must still match EACH OTHER)
--   lines unchanged        yes
--   column 13 clientId     uuid · nullable YES · default (none)
--   column 14 countedAt    timestamp with time zone · nullable YES · default (none)
--   constraint · u         stock_audit_lines_clientId_key  UNIQUE ("clientId")
--   index                  stock_audit_lines_clientId_key  ... USING btree ("clientId")
--   totals                 stock_audit_lines 14 columns · 8 constraints · 6 indexes
--                          (v27.79 live: 12 · 7 · 5 — p 1 · c 4 · f 2 — plus
--                           2 columns, 1 UNIQUE, and the UNIQUE's own index)
-- ============================================================================

SELECT * FROM (
  -- Row counts before / after — no row may have gone or come.
  SELECT 1 AS sec, 0 AS ord, 'before'::text AS kind, 'stock_audit_lines'::text AS name,
         (b.n::text || ' rows · pcs ' || b.pcs::text)::text AS detail
    FROM sa_v2780_before b
  UNION ALL
  SELECT 2, 0, 'after'::text, 'stock_audit_lines'::text,
         (count(*)::text || ' rows · pcs ' || COALESCE(sum("qty"), 0)::text)::text
    FROM stock_audit_lines
  UNION ALL
  SELECT 2, 1, 'after'::text, 'lines unchanged'::text,
         (CASE WHEN (SELECT n FROM sa_v2780_before) = (SELECT count(*) FROM stock_audit_lines)
                AND (SELECT pcs FROM sa_v2780_before) = (SELECT COALESCE(sum("qty"), 0) FROM stock_audit_lines)
               THEN 'yes' ELSE 'NO — STOP and report' END)::text
  UNION ALL
  -- The new columns must be NULL on every existing row.
  SELECT 2, 2, 'after'::text, 'rows with clientId / countedAt set'::text,
         ((SELECT count(*) FROM stock_audit_lines WHERE "clientId" IS NOT NULL)::text || ' / ' ||
          (SELECT count(*) FROM stock_audit_lines WHERE "countedAt" IS NOT NULL)::text || ' (expect 0 / 0)')::text

  UNION ALL
  -- stock_audit_lines columns now.
  SELECT 3, c.ordinal_position::int, 'column'::text, c.column_name::text,
         (c.data_type::text || ' · nullable ' || c.is_nullable::text
          || ' · default ' || COALESCE(c.column_default::text, '(none)'))::text
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'stock_audit_lines'

  UNION ALL
  -- Constraints now.
  SELECT 4, 0, ('constraint · ' || k.contype::text)::text, k.conname::text,
         pg_get_constraintdef(k.oid)::text
    FROM pg_constraint k
   WHERE k.conrelid = 'public.stock_audit_lines'::regclass

  UNION ALL
  -- Indexes now.
  SELECT 5, 0, 'index'::text, i.indexname::text, i.indexdef::text
    FROM pg_indexes i
   WHERE i.schemaname = 'public' AND i.tablename::text = 'stock_audit_lines'

  UNION ALL
  -- Totals, against the Expect block (14 · 8 · 6).
  SELECT 6, 0, 'totals'::text, 'stock_audit_lines'::text,
         ((SELECT count(*) FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'stock_audit_lines')::text || ' columns · ' ||
          (SELECT count(*) FROM pg_constraint
            WHERE conrelid = 'public.stock_audit_lines'::regclass)::text || ' constraints · ' ||
          (SELECT count(*) FROM pg_indexes
            WHERE schemaname = 'public' AND tablename::text = 'stock_audit_lines')::text || ' indexes'
          || ' (expect 14 · 8 · 6)')::text

  UNION ALL
  -- Expected and absent.
  SELECT 9, 0, 'MISSING'::text, ('stock_audit_lines.' || w.n)::text, NULL::text
    FROM unnest(ARRAY['clientId', 'countedAt']) AS w(n)
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'stock_audit_lines'
                        AND column_name::text = w.n)
  UNION ALL
  SELECT 9, 1, 'MISSING'::text, 'constraint stock_audit_lines_clientId_key'::text, NULL::text
   WHERE NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conrelid = 'public.stock_audit_lines'::regclass
                        AND conname::text = 'stock_audit_lines_clientId_key' AND contype::text = 'u')
  UNION ALL
  SELECT 9, 2, 'MISSING'::text, 'index stock_audit_lines_clientId_key'::text, NULL::text
   WHERE NOT EXISTS (SELECT 1 FROM pg_indexes
                      WHERE schemaname = 'public' AND indexname::text = 'stock_audit_lines_clientId_key')
) v
ORDER BY sec, ord, kind, name;


-- ============================================================================
-- 5. ROLLBACK — ⚠ READ BEFORE USING. Fully commented out.
--   SAFE ONLY BEFORE THE NEW CODE WRITES THESE COLUMNS. Once the phone's
--   queue code is live, dropping "clientId" removes the double-save guard
--   (a retried entry would insert a second line) and dropping "countedAt"
--   loses the phone's count times for good. Revert Prisma + code first
--   (`npx prisma generate`), then run. Remove the leading "-- " and run as
--   one paste. The constraint goes first (its index goes with it).
-- ============================================================================

-- SET statement_timeout = 0;
-- ALTER TABLE stock_audit_lines DROP CONSTRAINT IF EXISTS "stock_audit_lines_clientId_key";
-- ALTER TABLE stock_audit_lines DROP COLUMN IF EXISTS "countedAt";
-- ALTER TABLE stock_audit_lines DROP COLUMN IF EXISTS "clientId";
