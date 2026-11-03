-- ============================================================================
-- sql/2026-11-03-v27.79-stock-audit-simplify.sql
-- 2026-11-03 · Stock audit SIMPLIFY — one "Qty (pcs)" per line, no counter
-- list, at most one open audit.
--
-- Planned Schema v27.79 (CORE's header and §7 chain read v27.78 on 2026-11-03 —
-- sql/2026-11-02-v27.78-stock-audit.sql). ⚠ NOT RUN. The version is minted only
-- after the owner runs this file and the read-back (section 6) comes back with
-- no MISSING and no STILL-PRESENT row. Prisma is hand-edited to match, never
-- `db push` / `db pull` (CORE §3).
--
-- This file REPLACES the "v27.79 drop SQL" planned on 2026-11-02 (drop
-- stock_audit_counters + one-open index). That one was never written; its two
-- changes are sections 3 and 5 here.
--
-- ── DECISION (Smart Flow, 2026-11-03) ───────────────────────────────────────
--   Entry is: pick SKU → type ONE number "Qty (pcs)" → Submit. No calculator,
--   no Pieces/Cartons, no stack/depth/rows/pcs-per-carton/loose. Qty is always
--   pieces; counters do the maths off the app. So stock_audit_lines keeps only
--   the number, renamed "totalPcs" → "qty", and must be > 0.
--   Open counting (2026-11-02): no counter list — stock_audit_counters goes.
--   At most ONE audit open at a time — now a database rule, not only the app's.
--
-- ── LIVE STATE (read-only SELECTs, 2026-11-03) — TEST DATA ONLY ─────────────
--   stock_audits 1 (SA-0001, open) · stock_audit_counters 2 · stock_audit_lines 9
--   (all live, every "totalPcs" > 0 — the old CHECK guaranteed it). No FK, view,
--   rule or trigger references stock_audit_counters. Exactly one open audit, so
--   the one-open index in section 5 builds.
--   NO ROW IS DELETED OR CHANGED BY THIS FILE. The 9 lines keep their number
--   (it simply becomes "qty"). Clearing the test data before go-live is a
--   SEPARATE SQL.
--
-- ── HOW TO RUN (Smart Flow, Supabase SQL Editor) ─────────────────────────────
--   ⚠ DEPLOY ORDER: run this ONLY when the matching code is committed locally
--   and NOT yet pushed. Run it → check the read-back → then push. Between the
--   run and the Vercel deploy, the live screens read columns that are gone and
--   error (test data only — accepted).
--   The whole file in ONE paste, top to bottom. No BEGIN/COMMIT (CORE §3). The
--   editor shows only the LAST result — the read-back.
--   🔴 SINGLE-RUN FILE. Section 2 REFUSES the paste (nothing changed) unless the
--   tables are exactly in their v27.78 shape — so a second paste stops at once.
--   The editor runs a paste as one implicit transaction, so a failure part-way
--   normally leaves NOTHING behind — confirm by pasting the section 2 DO block
--   alone (read-only: it only checks and prints): it must pass again. Then fix
--   the cause and paste the whole file again. (Section 6 cannot run alone in
--   a new session: its first rows read section 2's temp snapshot.)
--   Never with session_replication_role = replica (CORE §13).
-- ============================================================================


-- ============================================================================
-- 1. TIMEOUT (the postgres role's statement_timeout is 30s).
-- ============================================================================

SET statement_timeout = 0;


-- ============================================================================
-- 2. GUARD — the v27.78 shape, or stop. Also prints the row counts.
--   Refuses when: stock_audit_counters is gone · stock_audit_lines has no
--   "stack" / "totalPcs", or already has "qty" · any of the four CHECKs this
--   file drops is missing · anything references stock_audit_counters (FK, view
--   or rule) · more than one audit is open (the index in section 5 would fail)
--   · the one-open index already exists.
-- ============================================================================

DO $$
DECLARE
  v_problems text := '';
  v_n        int;
  v_audits   bigint;
  v_counters bigint;
  v_lines    bigint;
BEGIN
  IF to_regclass('public.stock_audit_counters') IS NULL THEN
    v_problems := v_problems || ' · stock_audit_counters does not exist';
  END IF;
  IF to_regclass('public.stock_audit_lines') IS NULL OR to_regclass('public.stock_audits') IS NULL THEN
    RAISE EXCEPTION 'stock audit v27.79: stock_audits / stock_audit_lines missing — v27.78 was never run. Nothing was changed.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'stock_audit_lines' AND column_name = 'stack') THEN
    v_problems := v_problems || ' · stock_audit_lines has no "stack"';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'stock_audit_lines' AND column_name = 'totalPcs') THEN
    v_problems := v_problems || ' · stock_audit_lines has no "totalPcs"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'stock_audit_lines' AND column_name = 'qty') THEN
    v_problems := v_problems || ' · stock_audit_lines already has "qty"';
  END IF;

  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid = 'public.stock_audit_lines'::regclass
     AND conname IN ('chk_stock_audit_lines_carton', 'chk_stock_audit_lines_nonneg',
                     'chk_stock_audit_lines_total', 'chk_stock_audit_lines_mode');
  IF v_n <> 4 THEN
    v_problems := v_problems || ' · expected 4 old CHECKs on stock_audit_lines, found ' || v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.stock_audit_lines'::regclass AND conname = 'chk_stock_audit_lines_qty') THEN
    v_problems := v_problems || ' · chk_stock_audit_lines_qty already exists';
  END IF;
  IF to_regclass('public.stock_audits_one_open_key') IS NOT NULL THEN
    v_problems := v_problems || ' · stock_audits_one_open_key already exists';
  END IF;

  IF to_regclass('public.stock_audit_counters') IS NOT NULL THEN
    -- Nothing may hang off the table we drop (the DROP has no CASCADE anyway).
    SELECT count(*) INTO v_n FROM pg_constraint
     WHERE confrelid = 'public.stock_audit_counters'::regclass;
    IF v_n > 0 THEN
      v_problems := v_problems || ' · ' || v_n || ' FK(s) reference stock_audit_counters';
    END IF;
    SELECT count(*) INTO v_n
      FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid
     WHERE d.refobjid = 'public.stock_audit_counters'::regclass AND r.ev_class <> d.refobjid;
    IF v_n > 0 THEN
      v_problems := v_problems || ' · a view or rule depends on stock_audit_counters';
    END IF;
    EXECUTE 'SELECT count(*) FROM stock_audit_counters' INTO v_counters;
  END IF;

  SELECT count(*) INTO v_n FROM stock_audits WHERE "status" = 'open';
  IF v_n > 1 THEN
    v_problems := v_problems || ' · ' || v_n || ' audits are open — close all but one first';
  END IF;

  IF v_problems <> '' THEN
    RAISE EXCEPTION 'stock audit v27.79: not in the v27.78 shape (already run?):%. Nothing was changed.', v_problems;
  END IF;

  SELECT count(*) INTO v_audits FROM stock_audits;
  SELECT count(*) INTO v_lines  FROM stock_audit_lines;
  RAISE NOTICE 'stock audit v27.79 — before: stock_audits % · stock_audit_counters % · stock_audit_lines % (test data only; no row is deleted)',
    v_audits, v_counters, v_lines;
END
$$;

-- The "before" snapshot, for the read-back (notices are easy to miss in the
-- editor). A session temp table: it vanishes when the editor's session ends.
DROP TABLE IF EXISTS pg_temp.sa_v2779_before;
CREATE TEMP TABLE sa_v2779_before AS
  SELECT 'stock_audits'::text AS tbl, count(*)::bigint AS n, NULL::bigint AS pcs FROM stock_audits
  UNION ALL SELECT 'stock_audit_counters', count(*), NULL FROM stock_audit_counters
  UNION ALL SELECT 'stock_audit_lines', count(*), COALESCE(sum("totalPcs"), 0) FROM stock_audit_lines;


-- ============================================================================
-- 3. DROP stock_audit_counters — open counting, no counter list.
--   No CASCADE: section 2 proved nothing references it; if something did, the
--   DROP would fail and the whole paste roll back. Its own two FKs (to
--   stock_audits and users), its UNIQUE and its index go with it.
--   ⚠ Its 2 test rows are gone for good (see section 7).
-- ============================================================================

DROP TABLE stock_audit_counters;


-- ============================================================================
-- 4. stock_audit_lines — one number per line.
--   a) drop the four CHECKs that read the working columns (they must go
--      before the columns do);
--   b) "totalPcs" → "qty" (a RENAME keeps every value — the 9 test lines keep
--      their number);
--   c) qty > 0 (the old total CHECK's "> 0" half; zero-qty lines stay refused);
--   d) drop the six working columns.
--   Kept as they were: material / catalog / removed CHECKs, both FKs, all five
--   indexes (none of them names a dropped column).
-- ============================================================================

ALTER TABLE stock_audit_lines DROP CONSTRAINT chk_stock_audit_lines_carton;
ALTER TABLE stock_audit_lines DROP CONSTRAINT chk_stock_audit_lines_nonneg;
ALTER TABLE stock_audit_lines DROP CONSTRAINT chk_stock_audit_lines_total;
ALTER TABLE stock_audit_lines DROP CONSTRAINT chk_stock_audit_lines_mode;

ALTER TABLE stock_audit_lines RENAME COLUMN "totalPcs" TO "qty";

ALTER TABLE stock_audit_lines
  ADD CONSTRAINT chk_stock_audit_lines_qty CHECK ("qty" > 0);

ALTER TABLE stock_audit_lines DROP COLUMN "mode";
ALTER TABLE stock_audit_lines DROP COLUMN "stack";
ALTER TABLE stock_audit_lines DROP COLUMN "rows";
ALTER TABLE stock_audit_lines DROP COLUMN "depth";
ALTER TABLE stock_audit_lines DROP COLUMN "pcsPerCarton";
ALTER TABLE stock_audit_lines DROP COLUMN "loose";


-- ============================================================================
-- 5. ONE OPEN AUDIT — partial UNIQUE index.
--   UNIQUE on "status", but only over rows WHERE status = 'open'. Every row in
--   that set has the same status value, so a second open row is a duplicate →
--   the INSERT fails (Prisma P2002). Closed rows are outside the index, so any
--   number of closed audits is fine. Equivalent to the "UNIQUE ((true)) WHERE
--   open" idiom, written on a real column so it reads plainly.
--   The app checks first (409 AUDIT_ALREADY_OPEN); this catches two clicks in
--   the same instant. app/api/stock-audit/audits/route.ts already maps a P2002
--   that is NOT a number collision to the same 409 — the index name contains
--   neither "seq" nor "auditNumber", so lib/stock-audit/number.ts
--   isAuditNumberCollision does not mistake it for one.
--   Prisma cannot model a partial index — it lives only here and in CORE §7.20.
-- ============================================================================

CREATE UNIQUE INDEX stock_audits_one_open_key
  ON stock_audits ("status") WHERE "status" = 'open';


-- ============================================================================
-- 6. READ-BACK — READ-ONLY, the last statement (the one the editor shows).
-- Expect, with NO 'MISSING' and NO 'STILL-PRESENT' row:
--   before   stock_audits 1 · stock_audit_counters 2 · stock_audit_lines 9 (pcs 4142)
--   after    stock_audits 1 · stock_audit_lines 9 · sum(qty) 4142 · min(qty) > 0
--            · open audits 1
--   stock_audits       9 columns · 9 constraints · 5 indexes (+ stock_audits_one_open_key)
--   stock_audit_lines 12 columns · 7 constraints (p 1 · c 4 · f 2) · 5 indexes
--   (Counts as of the 2026-11-03 read; if test lines were added since, "before"
--   and "after" must still match EACH OTHER.)
-- ============================================================================

SELECT * FROM (
  -- Row counts before the change (snapshot from section 2).
  SELECT 1 AS sec, 0 AS ord,
         'before'::text AS kind,
         b.tbl::text AS name,
         (b.n::text || COALESCE(' rows · pcs ' || b.pcs::text, ' rows'))::text AS detail
    FROM sa_v2779_before b

  UNION ALL
  -- Row counts after — no row may have gone.
  SELECT 2, 1, 'after'::text, 'stock_audits'::text, (count(*)::text || ' rows')::text FROM stock_audits
  UNION ALL
  SELECT 2, 2, 'after'::text, 'stock_audit_lines'::text,
         (count(*)::text || ' rows · pcs ' || COALESCE(sum("qty"), 0)::text
          || ' · min qty ' || COALESCE(min("qty")::text, '(none)'))::text
    FROM stock_audit_lines
  UNION ALL
  SELECT 2, 3, 'after'::text, 'open audits'::text, count(*)::text FROM stock_audits WHERE "status" = 'open'
  UNION ALL
  -- Lines and pcs must match the snapshot exactly.
  SELECT 2, 4, 'after'::text, 'lines + pcs unchanged'::text,
         (CASE WHEN (SELECT n FROM sa_v2779_before WHERE tbl = 'stock_audit_lines') = (SELECT count(*) FROM stock_audit_lines)
                AND (SELECT pcs FROM sa_v2779_before WHERE tbl = 'stock_audit_lines') = (SELECT COALESCE(sum("qty"), 0) FROM stock_audit_lines)
               THEN 'yes' ELSE 'NO — STOP and report' END)::text

  UNION ALL
  -- stock_audit_lines columns now.
  SELECT 3, c.ordinal_position::int, 'column'::text, c.column_name::text,
         (c.data_type::text || ' · nullable ' || c.is_nullable::text
          || ' · default ' || COALESCE(c.column_default::text, '(none)'))::text
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'stock_audit_lines'

  UNION ALL
  -- Constraints on both tables now.
  SELECT 4, 0, ('constraint · ' || r.relname::text || ' · ' || k.contype::text)::text, k.conname::text,
         pg_get_constraintdef(k.oid)::text
    FROM pg_constraint k
    JOIN pg_class r ON r.oid = k.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'public' AND r.relname::text IN ('stock_audits', 'stock_audit_lines')

  UNION ALL
  -- Indexes on both tables now.
  SELECT 5, 0, ('index · ' || i.tablename::text)::text, i.indexname::text, i.indexdef::text
    FROM pg_indexes i
   WHERE i.schemaname = 'public' AND i.tablename::text IN ('stock_audits', 'stock_audit_lines')

  UNION ALL
  -- Per-table totals, against the Expect block.
  SELECT 6, 0, 'totals'::text, w.tbl::text,
         ((SELECT count(*) FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = w.tbl)::text || ' columns · ' ||
          (SELECT count(*) FROM pg_constraint k JOIN pg_class r ON r.oid = k.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'public' AND r.relname::text = w.tbl)::text || ' constraints · ' ||
          (SELECT count(*) FROM pg_indexes
            WHERE schemaname = 'public' AND tablename::text = w.tbl)::text || ' indexes')::text
    FROM unnest(ARRAY['stock_audits', 'stock_audit_lines']) AS w(tbl)

  UNION ALL
  -- Expected and absent.
  SELECT 9, 0, 'MISSING'::text, w.n::text, NULL::text
    FROM unnest(ARRAY[
      'stock_audits', 'stock_audit_lines',
      'chk_stock_audit_lines_qty', 'chk_stock_audit_lines_material',
      'chk_stock_audit_lines_catalog', 'chk_stock_audit_lines_removed',
      'stock_audit_lines_pkey', 'stock_audit_lines_auditId_fkey', 'stock_audit_lines_countedById_fkey',
      'stock_audit_lines_auditId_material_idx', 'stock_audit_lines_live_auditId_material_idx',
      'stock_audit_lines_auditId_countedById_createdAt_idx', 'stock_audit_lines_auditId_updatedAt_idx',
      'stock_audits_one_open_key'
    ]) AS w(n)
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables
                      WHERE table_schema = 'public' AND table_name = w.n)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint k JOIN pg_namespace n ON n.oid = k.connamespace
                      WHERE n.nspname = 'public' AND k.conname::text = w.n)
     AND NOT EXISTS (SELECT 1 FROM pg_indexes
                      WHERE schemaname = 'public' AND indexname::text = w.n)
  UNION ALL
  SELECT 9, 1, 'MISSING'::text, 'stock_audit_lines.qty'::text, NULL::text
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'stock_audit_lines' AND column_name = 'qty')

  UNION ALL
  -- Should be gone and is not.
  SELECT 10, 0, 'STILL-PRESENT'::text, w.n::text, NULL::text
    FROM unnest(ARRAY[
      'stock_audit_counters',
      'stock_audit_counters_pkey', 'stock_audit_counters_auditId_userId_key',
      'stock_audit_counters_userId_idx',
      'stock_audit_counters_auditId_fkey', 'stock_audit_counters_userId_fkey',
      'stock_audit_counters_addedById_fkey',
      'chk_stock_audit_lines_carton', 'chk_stock_audit_lines_nonneg',
      'chk_stock_audit_lines_total', 'chk_stock_audit_lines_mode'
    ]) AS w(n)
   WHERE EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema = 'public' AND table_name = w.n)
      OR EXISTS (SELECT 1 FROM pg_constraint k JOIN pg_namespace n ON n.oid = k.connamespace
                  WHERE n.nspname = 'public' AND k.conname::text = w.n)
      OR EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND indexname::text = w.n)
  UNION ALL
  SELECT 10, 1, 'STILL-PRESENT'::text, ('stock_audit_lines.' || c.column_name)::text, NULL::text
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'stock_audit_lines'
     AND c.column_name IN ('mode', 'stack', 'rows', 'depth', 'pcsPerCarton', 'loose', 'totalPcs')
) v
ORDER BY sec, ord, kind, name;


-- ============================================================================
-- 7. ROLLBACK — ⚠ READ BEFORE USING. Fully commented out.
--   WHAT CANNOT BE ROLLED BACK:
--     · the six dropped columns (mode, stack, rows, depth, pcsPerCarton,
--       loose) — their VALUES are gone. Re-adding them can only rebuild each
--       line as "loose-only" (stack/rows/depth 0, loose = qty, pieces), which
--       satisfies the old CHECKs but is not the working that was typed;
--     · the 2 stock_audit_counters rows — the table comes back EMPTY.
--   Only test data exists (SA-0001, 9 lines), so nothing real is lost.
--   Use only if the owner says roll back, and revert Prisma + code to
--   0f495c67 with it (`npx prisma generate`). Remove the leading "-- " and run
--   as one paste.
-- ============================================================================

-- SET statement_timeout = 0;
-- DROP INDEX IF EXISTS stock_audits_one_open_key;
-- ALTER TABLE stock_audit_lines DROP CONSTRAINT IF EXISTS chk_stock_audit_lines_qty;
-- ALTER TABLE stock_audit_lines RENAME COLUMN "qty" TO "totalPcs";
-- ALTER TABLE stock_audit_lines ADD COLUMN "mode"         text    NOT NULL DEFAULT 'pieces';
-- ALTER TABLE stock_audit_lines ADD COLUMN "stack"        integer NOT NULL DEFAULT 0;
-- ALTER TABLE stock_audit_lines ADD COLUMN "rows"         integer NOT NULL DEFAULT 0;
-- ALTER TABLE stock_audit_lines ADD COLUMN "depth"        integer NOT NULL DEFAULT 0;
-- ALTER TABLE stock_audit_lines ADD COLUMN "pcsPerCarton" integer;
-- ALTER TABLE stock_audit_lines ADD COLUMN "loose"        integer NOT NULL DEFAULT 0;
-- UPDATE stock_audit_lines SET "loose" = "totalPcs", "updatedAt" = now();   -- loose-only rebuild
-- ALTER TABLE stock_audit_lines ALTER COLUMN "mode" DROP DEFAULT;
-- ALTER TABLE stock_audit_lines ADD CONSTRAINT chk_stock_audit_lines_mode CHECK ("mode" IN ('pieces', 'cartons'));
-- ALTER TABLE stock_audit_lines ADD CONSTRAINT chk_stock_audit_lines_nonneg CHECK ("stack" >= 0 AND "rows" >= 0 AND "depth" >= 0 AND "loose" >= 0);
-- ALTER TABLE stock_audit_lines ADD CONSTRAINT chk_stock_audit_lines_carton CHECK (("mode" = 'pieces' AND "pcsPerCarton" IS NULL) OR ("mode" = 'cartons' AND "pcsPerCarton" > 0));
-- ALTER TABLE stock_audit_lines ADD CONSTRAINT chk_stock_audit_lines_total CHECK ("totalPcs" > 0 AND "totalPcs"::bigint = "stack"::bigint * "rows"::bigint * "depth"::bigint * COALESCE("pcsPerCarton", 1)::bigint + "loose"::bigint);
-- CREATE TABLE stock_audit_counters (
--   "id" serial NOT NULL, "auditId" integer NOT NULL, "userId" integer NOT NULL,
--   "addedById" integer, "addedAt" timestamptz(6) NOT NULL DEFAULT now(),
--   CONSTRAINT "stock_audit_counters_pkey" PRIMARY KEY ("id"),
--   CONSTRAINT "stock_audit_counters_auditId_userId_key" UNIQUE ("auditId", "userId"),
--   CONSTRAINT "stock_audit_counters_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES stock_audits("id") ON DELETE CASCADE,
--   CONSTRAINT "stock_audit_counters_userId_fkey" FOREIGN KEY ("userId") REFERENCES users("id") ON DELETE RESTRICT,
--   CONSTRAINT "stock_audit_counters_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES users("id") ON DELETE SET NULL
-- );
-- CREATE INDEX "stock_audit_counters_userId_idx" ON stock_audit_counters ("userId");
