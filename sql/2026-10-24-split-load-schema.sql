-- ============================================================================
-- 2026-10-24 · Split load — PHASE 1 SCHEMA: source 'load' + "loadParentId"
--
-- Planned Schema v27.76 (the §7 chain's latest entry is v27.75,
-- sql/2026-10-24-trip-activity-ship-to-refresh.sql). ⚠ NOT RUN. Minted only
-- after the owner runs this file and the VERIFY block reads back clean.
-- Prisma (phase 2b) is edited AFTER the run, never before.
--
-- PURPOSE. Split load = ONE SAP invoice row divided across trucks (tins per
-- line). Plan: docs/prompts/drafts/web-update-2026-10-24-split-load-plan.md
-- §3-§4. Evidence: docs/prompts/drafts/code-discovery-2026-10-24-split-load.md.
-- A load PART is an order_invoices row with source 'load' that points at the
-- ORIGINAL row whose invoice number it shares ("loadParentId"). Re-splitting a
-- part points the new parts at the SAME original row (one flat group).
--
-- WHAT THIS DOES (order_invoices only; order_invoice_lines untouched):
--   · chk_order_invoices_source  ('sap','manual') → ('sap','manual','load')
--   · NEW "loadParentId" integer NULL
--   · NEW UNIQUE (id, "orderId") (order_invoices_id_orderId_key) — the target
--     the composite FK needs; id alone is already unique, so it refuses nothing.
--   · NEW composite FK ("loadParentId", "orderId") → order_invoices(id, "orderId")
--     ON DELETE RESTRICT (order_invoices_loadParentId_fkey) — a part's parent is
--     on the SAME OBD, and an original row cannot be deleted while a part points
--     at it. MATCH SIMPLE (the default): a NULL "loadParentId" is never checked.
--   · NEW chk_order_invoices_load_parent   source = 'load' ⇔ "loadParentId" set
--   · NEW chk_order_invoices_load_not_self a row is never its own parent
--   · NEW partial index order_invoices_loadParentId_idx (non-NULL only) — serves
--     "parts of this row" and the FK's RESTRICT check on every row DELETE.
--
-- DELIBERATELY UNCHANGED
--   · chk_order_invoices_manual_has_no ((source <> 'manual') OR "invoiceNo" IS
--     NOT NULL) — it stays for 'manual' only. A 'load' row MAY have a NULL
--     number: planning happens before billing (plan §3 case 12); the number is
--     a COPY of the parent's, filled by the app when SAP sends it.
--   · The UNIQUE ("orderId", seq) row identity; no (orderId, invoiceNo) unique —
--     a split load is exactly two rows with one number (DDL 2026-10-10 header).
--   · chk_order_invoices_no_not_blank, the hold / dispatch CHECKs, every FK.
--
-- DATABASE RULE (owner 2026-10-24):
--   · SAME OBD: a part's "orderId" = its parent's "orderId" — enforced by the
--     composite FK above, not by the app.
-- APP RULES — NOT CONSTRAINTS (a CHECK sees one row; these need two):
--   · FLAT GROUP: the parent is NOT itself a 'load' row.
--   · The part's "invoiceNo" / "invoiceDate" equal the parent's (one writer).
--   The phase-2 writer (lib/order-invoices/load-split.ts) enforces both.
--
-- LIVE FEED: no change. All 6 triggers on order_invoices read the WHOLE row
--   (to_jsonb), never a column list — live read 2026-10-24, PART 1d of the
--   phase-1a report. See section 8.
--
-- PRE-CHECK, READ-ONLY (2026-10-24, Claude Code): source sap 20,597 · manual 3
--   · 0 rows outside ('sap','manual','load') · 0 'load' rows · no column, FK,
--   CHECK or index of these names exists.
--
-- ── HOW TO RUN (Smart Flow, Supabase SQL Editor) ──────────────────────────────
--   The whole file in ONE paste, top to bottom. No BEGIN/COMMIT (CORE §3). The
--   editor shows only the LAST result — the VERIFY block. To SEE the pre-check
--   first, highlight section 2's SELECT and run it alone; section 2b ALSO
--   guards the paste: it raises an error (and the editor rolls the paste back)
--   if any row would break the new CHECKs.
--   Re-runnable: every step is IF [NOT] EXISTS-guarded. Locks: each ALTER takes
--   a brief ACCESS EXCLUSIVE lock on order_invoices (~20.6k rows; the CHECKs
--   scan them in milliseconds; the new column is NULL, so nothing is rewritten).
--   Never with session_replication_role = replica (CORE §13).
-- ============================================================================


-- ============================================================================
-- 1. TIMEOUT (the postgres role's statement_timeout is 30s).
-- ============================================================================

SET statement_timeout = 0;


-- ============================================================================
-- 2. PRE-CHECK — READ-ONLY. Expect: row 2 = 0 · row 3 = 0 · row 4 = 0 on the
-- first run (1 on a re-run, after the column exists).
-- ============================================================================

SELECT 1 AS k, ('rows · source = ' || source)::text AS what, count(*)::text AS value
  FROM order_invoices GROUP BY source
UNION ALL
SELECT 2, 'rows outside (sap, manual, load) — must be 0'::text, count(*)::text
  FROM order_invoices WHERE source NOT IN ('sap', 'manual', 'load')
UNION ALL
SELECT 3, 'rows with source = load — must be 0 (none can carry a parent yet)'::text, count(*)::text
  FROM order_invoices WHERE source = 'load'
UNION ALL
SELECT 4, 'column "loadParentId" exists'::text, count(*)::text
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'order_invoices' AND column_name = 'loadParentId'
ORDER BY 1, 2;

-- 2b. GUARD — stops the paste before any ALTER if a row would break a CHECK.
-- (On a re-run after the column exists, 'load' rows are checked against
-- "loadParentId" instead.)
DO $$
DECLARE
  v_bad_source int;
  v_bad_load   int;
  v_has_col    boolean;
BEGIN
  SELECT count(*) INTO v_bad_source FROM order_invoices WHERE source NOT IN ('sap', 'manual', 'load');
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'order_invoices'
                    AND column_name = 'loadParentId') INTO v_has_col;
  IF v_has_col THEN
    EXECUTE 'SELECT count(*) FROM order_invoices
              WHERE (source = ''load'') <> ("loadParentId" IS NOT NULL)
                 OR "loadParentId" = id' INTO v_bad_load;
  ELSE
    SELECT count(*) INTO v_bad_load FROM order_invoices WHERE source = 'load';
  END IF;
  IF v_bad_source > 0 OR v_bad_load > 0 THEN
    RAISE EXCEPTION 'split-load schema: pre-check failed — % row(s) outside the source list, % row(s) breaking the load-parent rules. Nothing was changed.', v_bad_source, v_bad_load;
  END IF;
END
$$;


-- ============================================================================
-- 3. SOURCE CHECK — ('sap','manual') → ('sap','manual','load').
-- ONE ALTER statement: the drop and the add are atomic, so there is no moment
-- with no source CHECK at all. Written in the live text's own shape.
-- ============================================================================

ALTER TABLE order_invoices
  DROP CONSTRAINT IF EXISTS chk_order_invoices_source,
  ADD  CONSTRAINT chk_order_invoices_source
       CHECK (source = ANY (ARRAY['sap'::text, 'manual'::text, 'load'::text]));


-- ============================================================================
-- 4. NEW COLUMN "loadParentId" + UNIQUE (id, "orderId") + the composite FK
-- (self, SAME OBD, ON DELETE RESTRICT).
-- The FK carries "orderId" on both sides, so a part can only point at a row of
-- its own OBD — "same OBD" is a DATABASE rule. Its target needs a unique on
-- exactly (id, "orderId"), added first. MATCH SIMPLE (the default): when
-- "loadParentId" is NULL — every non-'load' row — the FK is not checked.
-- RESTRICT, not CASCADE: deleting an original row must fail loudly while a
-- part points at it — every FK into order_invoices is RESTRICT (v27.66). A
-- merge-back deletes the PARTS (children), never the parent.
-- ============================================================================

ALTER TABLE order_invoices ADD COLUMN IF NOT EXISTS "loadParentId" integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_invoices_id_orderId_key') THEN
    ALTER TABLE order_invoices ADD CONSTRAINT "order_invoices_id_orderId_key"
      UNIQUE (id, "orderId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_invoices_loadParentId_fkey') THEN
    ALTER TABLE order_invoices ADD CONSTRAINT "order_invoices_loadParentId_fkey"
      FOREIGN KEY ("loadParentId", "orderId") REFERENCES order_invoices(id, "orderId")
      ON DELETE RESTRICT;
  END IF;
END
$$;


-- ============================================================================
-- 5. CHECK chk_order_invoices_load_parent — a 'load' row has a parent, and
-- ONLY a 'load' row has one. source is NOT NULL, so both sides are never NULL.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_order_invoices_load_parent') THEN
    ALTER TABLE order_invoices ADD CONSTRAINT chk_order_invoices_load_parent
      CHECK ((source = 'load') = ("loadParentId" IS NOT NULL));
  END IF;
END
$$;


-- ============================================================================
-- 6. CHECK chk_order_invoices_load_not_self — never its own parent.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_order_invoices_load_not_self') THEN
    ALTER TABLE order_invoices ADD CONSTRAINT chk_order_invoices_load_not_self
      CHECK ("loadParentId" IS NULL OR "loadParentId" <> id);
  END IF;
END
$$;


-- ============================================================================
-- 7. PARTIAL INDEX — only part rows are indexed (0 today; a handful later).
-- The FK's RESTRICT check ("loadParentId" = $1 AND "orderId" = $2) implies
-- NOT NULL, so it can use this index on every order_invoices DELETE.
-- ============================================================================

CREATE INDEX IF NOT EXISTS "order_invoices_loadParentId_idx"
  ON order_invoices ("loadParentId") WHERE "loadParentId" IS NOT NULL;


-- ============================================================================
-- 8. TRIGGER FUNCTIONS — NONE NEEDED.
-- Live read 2026-10-24 (pg_get_functiondef), the 6 triggers on order_invoices:
--   trg_live_changes_order_invoices_ins / _upd / _del
--     → live_changes_child_ins / _upd / _del ('order','parent','orderId'):
--       to_jsonb(n|o) of the WHOLE row, the key read by name ("orderId");
--       UPDATE compares to_jsonb(row) - 'updatedAt'.
--   trg_live_changes_order_invoices_trip_ins / _upd / _del
--     → live_changes_order_invoices_trip_ins / _upd / _del: read only
--       "tripDropId" by name; UPDATE compares to_jsonb(row) - 'updatedAt'.
-- No function lists columns, so "loadParentId" rides every one of them: a
-- change to it alone counts as a change (records entity 'order'). Nothing to
-- add. order_invoice_lines' triggers (v27.67) join order_invoices on id — also
-- unaffected.
-- ============================================================================


-- ============================================================================
-- 9. VERIFY — READ-ONLY, the last statement (the one the editor shows).
-- Expect, with no MISSING row:
--   10 chk_order_invoices_source   CHECK ((source = ANY (ARRAY['sap'::text, 'manual'::text, 'load'::text])))
--   11 chk_order_invoices_load_parent    CHECK (((source = 'load'::text) = ("loadParentId" IS NOT NULL)))
--   12 chk_order_invoices_load_not_self  CHECK ((("loadParentId" IS NULL) OR ("loadParentId" <> id)))
--   13 order_invoices_id_orderId_key     UNIQUE (id, "orderId")
--   14 order_invoices_loadParentId_fkey  FOREIGN KEY ("loadParentId", "orderId") REFERENCES order_invoices(id, "orderId") ON DELETE RESTRICT
--   20 column  integer · nullable YES · default (none)
--   30 index   CREATE INDEX "order_invoices_loadParentId_idx" ON public.order_invoices USING btree ("loadParentId") WHERE ("loadParentId" IS NOT NULL)
--   40 rows by source: sap ~20.6k · manual 3 (no 'load')
--   41 rows with a "loadParentId": 0
--   50 constraints on order_invoices: 18 (14 before + 2 CHECKs + unique + FK)
-- (Postgres prints the CHECK texts in its own normal form; the shape above is
-- the expected one — trust what comes back and record THAT in CORE §7.)
-- ============================================================================

SELECT (CASE c.conname
          WHEN 'chk_order_invoices_source'         THEN 10
          WHEN 'chk_order_invoices_load_parent'    THEN 11
          WHEN 'chk_order_invoices_load_not_self'  THEN 12
          WHEN 'order_invoices_id_orderId_key'     THEN 13
          ELSE 14 END)                  AS k,
       c.conname::text                 AS what,
       pg_get_constraintdef(c.oid)::text AS value
  FROM pg_constraint c
 WHERE c.conrelid = 'public.order_invoices'::regclass
   AND c.conname IN ('chk_order_invoices_source', 'chk_order_invoices_load_parent',
                     'chk_order_invoices_load_not_self', 'order_invoices_id_orderId_key',
                     'order_invoices_loadParentId_fkey')
UNION ALL
SELECT 19, ('MISSING constraint · ' || w.n)::text, NULL::text
  FROM unnest(ARRAY['chk_order_invoices_source', 'chk_order_invoices_load_parent',
                    'chk_order_invoices_load_not_self', 'order_invoices_id_orderId_key',
                    'order_invoices_loadParentId_fkey']) AS w(n)
 WHERE NOT EXISTS (SELECT 1 FROM pg_constraint c
                    WHERE c.conrelid = 'public.order_invoices'::regclass AND c.conname = w.n)
UNION ALL
SELECT 20, ('column · ' || col.column_name::text)::text,
       (col.data_type::text || ' · nullable ' || col.is_nullable::text
        || ' · default ' || COALESCE(col.column_default::text, '(none)'))::text
  FROM information_schema.columns col
 WHERE col.table_schema = 'public' AND col.table_name = 'order_invoices' AND col.column_name = 'loadParentId'
UNION ALL
SELECT 29, 'MISSING column · loadParentId'::text, NULL::text
 WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'order_invoices' AND column_name = 'loadParentId')
UNION ALL
SELECT 30, ('index · ' || i.indexname::text)::text, i.indexdef::text
  FROM pg_indexes i
 WHERE i.schemaname = 'public' AND i.indexname = 'order_invoices_loadParentId_idx'
UNION ALL
SELECT 39, 'MISSING index · order_invoices_loadParentId_idx'::text, NULL::text
 WHERE NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'order_invoices_loadParentId_idx')
UNION ALL
SELECT 40, ('rows · source = ' || oi.source)::text, count(*)::text
  FROM order_invoices oi GROUP BY oi.source
UNION ALL
SELECT 41, 'rows with a "loadParentId" (expect 0)'::text, count(*)::text
  FROM order_invoices WHERE "loadParentId" IS NOT NULL
UNION ALL
SELECT 50, 'constraints on order_invoices (expect 18)'::text, count(*)::text
  FROM pg_constraint WHERE conrelid = 'public.order_invoices'::regclass
ORDER BY 1, 2;


-- ============================================================================
-- 10. ROLLBACK — ⚠ ONLY IF THE OWNER SAYS ROLL BACK; RUN BEFORE ANY 'load' ROW
-- EXISTS. Fully commented out. Restoring the old source CHECK FAILS if a
-- 'load' row exists (correctly) — merge every part back through the app first.
-- Run it as one paste after removing the leading "-- " from each line; then
-- revert the phase-2b Prisma edit, if made, and `npx prisma generate`.
-- ============================================================================

-- SET statement_timeout = 0;
-- DROP INDEX IF EXISTS "order_invoices_loadParentId_idx";
-- ALTER TABLE order_invoices DROP CONSTRAINT IF EXISTS chk_order_invoices_load_not_self;
-- ALTER TABLE order_invoices DROP CONSTRAINT IF EXISTS chk_order_invoices_load_parent;
-- ALTER TABLE order_invoices DROP CONSTRAINT IF EXISTS "order_invoices_loadParentId_fkey";
-- ALTER TABLE order_invoices DROP CONSTRAINT IF EXISTS "order_invoices_id_orderId_key";
-- ALTER TABLE order_invoices DROP COLUMN IF EXISTS "loadParentId";
-- ALTER TABLE order_invoices
--   DROP CONSTRAINT IF EXISTS chk_order_invoices_source,
--   ADD  CONSTRAINT chk_order_invoices_source
--        CHECK (source = ANY (ARRAY['sap'::text, 'manual'::text]));
