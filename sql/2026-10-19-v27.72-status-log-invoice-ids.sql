-- ============================================================================
-- 2026-10-19 · Schema v27.72 · Add invoices, Phase 6 commit 1 (6.1): which
-- INVOICE ROWS a status-log row is about — order_status_logs."orderInvoiceIds".
--
-- WHY (owner, 2026-10-19). Hold / release now act per invoice on a split OBD
-- (lib/order-invoices/hold.ts). The detail panel scoped to one invoice shows an
-- entry on that invoice only when the entry names the invoice row in a
-- STRUCTURED field — never a note match (lib/floor/detail-scope.ts
-- activityForInvoice, owner rule 2026-10-13). order_status_logs had no such
-- field. One log row per PRESS, carrying every ticked row id → an int array.
--
-- MEANING:  "orderInvoiceIds" = the order_invoices ids this event touched.
--           EMPTY ('{}') = the event is about the WHOLE OBD — every row ever
--           written before v27.72, and every OBD-level action after it.
--           ⚠ NOT NULL DEFAULT '{}', not NULL-able: Prisma cannot map a NULL-able
--           scalar list (Int[] is always a list). Empty is the "whole OBD" value.
-- WRITER:   lib/order-invoices/hold.ts holdRows / releaseRows only (v27.72).
-- READERS:  lib/floor/order-detail.ts (Activity entries) → activityForInvoice.
-- ⚠ No FK (Postgres has none for array elements) and no GIN index — the reader
--   always goes by "orderId" first (one OBD's log, a few dozen rows).
--
-- Evidence before (read-only, 2026-10-19): order_status_logs 92,480 rows, 7
-- columns, 3 constraints (pkey + 2 FKs), NO user triggers.
--
-- 🔴 DEPLOY ORDER: run PART 2 BEFORE the 6.1 code deploys AND before anyone
-- runs a dev server on a checkout that has run `npx prisma generate` with this
-- field — that client asks for the column on every order_status_logs write
-- (P2022 until it exists). Old code is unaffected by the new column (the
-- DEFAULT fills it).
--
-- HOW TO RUN (Smart Flow, Supabase SQL Editor): each PART on its own, in order.
-- No BEGIN/COMMIT. Re-runnable. Never with session_replication_role = replica.
-- ============================================================================


-- ============================================================================
-- PART 1 — READ-ONLY PRE-CHECK. Expect: column_exists false · rows 92,480+.
-- ============================================================================
SELECT 'column_exists' AS chk,
       (EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'order_status_logs'
                   AND column_name = 'orderInvoiceIds'))::text AS value
UNION ALL
SELECT 'rows', (SELECT count(*) FROM order_status_logs)::text;


-- ============================================================================
-- PART 2 — DDL. Re-runnable. A constant DEFAULT is metadata-only on Postgres
-- 11+ (no table rewrite, no row UPDATE, no trigger fires — the table has none).
-- ============================================================================
ALTER TABLE order_status_logs
  ADD COLUMN IF NOT EXISTS "orderInvoiceIds" integer[] NOT NULL DEFAULT '{}'::integer[];


-- ============================================================================
-- PART 3 — READ-ONLY VERIFY. Expect: one row "integer[] · NO · '{}'::integer[]"
-- (data_type reads ARRAY, udt_name _int4) · non_empty 0 · rows = PART 1.
-- ============================================================================
SELECT 'column' AS chk,
       (data_type || ' ' || udt_name || ' · nullable ' || is_nullable || ' · default ' || coalesce(column_default, 'none'))::text AS value
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'order_status_logs' AND column_name = 'orderInvoiceIds'
UNION ALL
SELECT 'non_empty', (SELECT count(*) FROM order_status_logs WHERE cardinality("orderInvoiceIds") > 0)::text
UNION ALL
SELECT 'rows', (SELECT count(*) FROM order_status_logs)::text;
