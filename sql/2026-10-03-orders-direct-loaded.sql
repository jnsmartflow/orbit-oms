-- ═══════════════════════════════════════════════════════════════════════════
-- Picking · Direct Loading — orders.directLoadedAt / directLoadedById
-- 2026-10-03 · discovery: the Direct Loading read-only diagnosis (same day)
--
-- Run in the Supabase SQL Editor, top to bottom, in ONE paste. NO transaction
-- wrapper — BEGIN/COMMIT fails silently there (CORE §3). camelCase identifiers,
-- quoted. Timestamps timestamptz(6).
--
-- WRITTEN, NOT RUN. Nothing in the app reads or writes these columns yet.
--
-- ── WHAT THIS FILE CHANGES (plain English) ────────────────────────────────
--   orders gains two nullable columns:
--     directLoadedAt   — when a picking supervisor sent the bill straight to
--                        pick_checked without a picker ("Direct Loading")
--     directLoadedById — who pressed it (FK users, ON DELETE SET NULL)
--   Timestamp + actor, the house shape for a decision (pickEarlyReleasedAt/ById,
--   invoicedAt/ById, handAt/ById). NOT a new workflowStage value and NOT on
--   pick_assignments (a bill with no picker has no assignment row).
--   🔴 NOT orders.loadedAt / loadedById — those are reserved for the future
--   Vehicle Loading screen. Different fact, different columns.
--   No CHECK tying the flag to workflowStage: Undo clears both columns.
--
--   NO DATA IS WRITTEN. Every existing row stays NULL = "not direct loaded",
--   exactly the truth today. Nullable, no default ⇒ metadata-only ALTER.
--
-- ── SCHEMA VERSION ────────────────────────────────────────────────────────
--   CORE header (read 2026-10-03): v123 · Schema v27.51. This file is the NEXT
--   chain entry, minted in CORE §7 in part B after the verify result is back.
--   ⚠ sql/2026-10-03-trip-redelivery.sql (untracked, another session) is also
--   unminted — whichever runs live first takes v27.52. MINTED: v27.52 (run live 2026-10-03).
--
-- ── RE-RUN SAFETY ─────────────────────────────────────────────────────────
--   ADD COLUMN IF NOT EXISTS · FK added in a DO block that tests pg_constraint
--   first. A second paste changes nothing.
--   ⚠ IF NOT EXISTS skips a column that already exists WHATEVER its type — the
--   verification prints each column's type. Read it.
--
-- ── NAMES ─────────────────────────────────────────────────────────────────
--   FK uses Prisma's own default name ({table}_{col}_fkey), as orders_handById_fkey
--   did (v27.41), so the hand-edited schema needs no `map:`. Double-quoted —
--   an unquoted camelCase name folds to lower case.
--
-- ── INDEX: NONE, deliberately ─────────────────────────────────────────────
--   Same call as orders.handAt (v27.41) and the pickEarlyReleasedAt / invoicedAt
--   pairs, none of which carries an index: every read that will test this flag
--   is already narrowed by workflowStage = 'pick_checked' (orders_workflowStage_idx)
--   plus a today window, i.e. tens of rows.
--
-- ── PRISMA (part B, not this file) ────────────────────────────────────────
--   orders.directLoadedBy users? @relation("OrderDirectLoadedBy", …,
--   onDelete: SetNull) + back-relation on users. The NINTH FK from orders to
--   users — must be named on both sides (CORE §7.3 ambiguity trap).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE orders ADD COLUMN IF NOT EXISTS "directLoadedAt"   timestamptz(6);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "directLoadedById" integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_directLoadedById_fkey') THEN
    ALTER TABLE orders ADD CONSTRAINT "orders_directLoadedById_fkey"
      FOREIGN KEY ("directLoadedById") REFERENCES users("id") ON DELETE SET NULL;
  END IF;
END $$;


-- ───────────────────────────────────────────────────────────────────────────
-- Verification — ONE SELECT (the editor shows only the last result).
--
-- Expect:
--   column orders."directLoadedAt"    timestamp with time zone · nullable YES
--   column orders."directLoadedById"  integer · nullable YES
--   constraint orders_directLoadedById_fkey  f · FOREIGN KEY ("directLoadedById")
--     REFERENCES users(id) ON DELETE SET NULL
--   index: none added (row says so)
--   rows marked: 0
-- ───────────────────────────────────────────────────────────────────────────

SELECT sort_order, item, value FROM (

  SELECT 1 AS sort_order,
         ('column orders."' || x.col || '"')::text AS item,
         COALESCE((SELECT (c.data_type || ' · udt ' || c.udt_name
                           || COALESCE(' · precision ' || c.datetime_precision, '')
                           || ' · nullable ' || c.is_nullable
                           || COALESCE(' · default ' || c.column_default, ''))::text
                     FROM information_schema.columns c
                    WHERE c.table_schema = 'public'
                      AND c.table_name = 'orders' AND c.column_name = x.col), 'MISSING')::text AS value
    FROM (VALUES ('directLoadedAt'), ('directLoadedById')) AS x(col)

  UNION ALL
  SELECT 2, 'constraint orders_directLoadedById_fkey'::text,
         COALESCE((SELECT (c.conname::text || ' · ' || c.contype::text || ' · '
                           || pg_get_constraintdef(c.oid))::text
                     FROM pg_constraint c
                    WHERE c.conname = 'orders_directLoadedById_fkey'), 'MISSING')::text

  UNION ALL
  SELECT 3, 'index on directLoaded* (expect none)'::text,
         COALESCE((SELECT string_agg(i.indexname || ' · ' || i.indexdef, ' | ')::text
                     FROM pg_indexes i
                    WHERE i.schemaname = 'public' AND i.tablename = 'orders'
                      AND i.indexdef ILIKE '%directLoaded%'), 'none (by design)')::text

  UNION ALL
  SELECT 4, 'rows marked (expect 0)'::text,
         (SELECT count(*) FROM orders
           WHERE "directLoadedAt" IS NOT NULL OR "directLoadedById" IS NOT NULL)::text

) v
ORDER BY sort_order, item;
