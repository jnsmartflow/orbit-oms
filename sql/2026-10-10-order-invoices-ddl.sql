-- ============================================================================
-- 2026-10-10 · Add invoices — PHASE 1, DATA ONLY: order_invoices + order_invoice_lines
--
-- Schema v27.63. ✅ RUN 2026-10-10 by the owner in the Supabase SQL Editor,
-- PARTS 1-4 in order, clean. PART 4: orders 18109 · order_invoices 18109 ·
-- seq-1 18109 · lines 0 · orders without seq-1 0 · invoiceNo differs 0 ·
-- invoiceDate differs 0 · seq-1 with invoice 12314 · 13 constraints · 6
-- indexes. Constraint text re-read live the same day (pg_get_constraintdef) and
-- recorded in docs/CLAUDE_CORE.md §7 (v27.63) and prisma/schema.prisma.
-- ⚠ Drafted as "v27.62"; that number went to sql/2026-10-10-v27.62-sales-
-- officer-aliases.sql first (5f4a1cbd), so it is minted here as v27.63 — the
-- v27.59/v27.60 precedent.
--
-- PURPOSE. SAP sometimes bills ONE OBD as SEVERAL invoices (live: OBD
-- 9109951956, invoiced I536230713/714/715/716; Orbit holds only I536230716).
-- Auto-import and patch-headers deliver ONE invoice per OBD, so the rest are
-- recorded by hand ("Add invoices", mockup docs/mockups/add-invoices/
-- add-invoices-flow.html). Model A (owner-approved 2026-10-09 diagnosis):
--   · EVERY order has order_invoices rows. An unsplit OBD has exactly ONE row
--     (seq 1, source 'sap') and NO line rows — "no line rows" MEANS "all lines
--     of the OBD", so an import that soft-removes or patches a line needs no
--     write here.
--   · A split OBD has n rows (seq 1..n; seq 1 stays the SAP invoice) and
--     order_invoice_lines saying which raw line, how many TINS, sits on which.
--   · orders.invoiceNo STAYS the SAP invoice. Cancel stays per OBD. Kg per
--     invoice is derived (header kg shared by litres) and NOT stored.
--   · PHASE 1 adds NO tripDropId / hold / dispatch columns — later phases.
--
-- 🔴 SPLIT LOAD (later) MUST STAY POSSIBLE: the row identity is (orderId, seq).
--   There is deliberately NO unique on (orderId, invoiceNo) — one invoice may
--   later be two rows (two vehicles, tins divided per line). "Same number typed
--   twice on one OBD" is refused by the APP (the mockup's "already added").
--
-- DECISIONS (evidence: scripts/_chk-oi-ddl-20261010.ts, read-only, 2026-10-10)
--   · order_invoices.orderId → orders ON DELETE RESTRICT. No code path deletes
--     an order (no `.orders.delete*` / `DELETE FROM orders` in app/, lib/,
--     scripts/, sql/, the .ps1 files); orders are soft-removed (isRemoved). 16
--     live FKs to orders are NO ACTION and every table added since v27.5x
--     (ci_returns, trip_bill_copies, trip_redeliveries, freight_trip_bills,
--     challan_order_so_links, so_tag_matches) uses RESTRICT — follow them. A
--     hand DELETE of an order must fail loudly, not silently lose its invoices.
--   · order_invoices.createdById → users ON DELETE SET NULL. NULL = system
--     (back-fill, import, patch-headers); a user row going away must not block
--     on, or delete, an invoice record (unlinkedById precedent, v27.60).
--   · order_invoice_lines.rawLineItemId IS A REAL FK → import_raw_line_items
--     ON DELETE RESTRICT (unlike ci_return_lines, which is a plain Int by its
--     spec, not by evidence). Raw line ids are STABLE: re-import PATCHES a line
--     in place, matched on (lineId, skuCodeRaw) (lib/import-upsert/lines.ts:98,
--     :208), soft-removes with lineStatus 'removed_by_import' (:159, :215), and
--     only ADDS rows for new lines (:187). No code deletes a raw line. Live: 0
--     OBDs with more than one import_raw_summary row, 0 duplicate active
--     (lineId, sku) keys; 6 live FKs already point at import_raw_line_items(id)
--     (pick_findings, split_line_items, delivery_challan_formulas, …).
--     ⚠ App rule, not a constraint: a split line can later be soft-removed or
--     have its unitQty patched by re-import — the Phase 2 reader must handle a
--     line row whose raw line is no longer 'active' or whose qty now exceeds it.
--   · order_invoice_lines.orderInvoiceId → order_invoices ON DELETE CASCADE —
--     the lines are part of the invoice row ("Undo" deletes the manual rows).
--   · REMOVED orders ARE back-filled (51 live, 11 with an invoice). The
--     invariant "every order has a seq-1 row" then holds with no exceptions,
--     so no reader ever needs a fallback; a removed OBD can be restored
--     (restoredAt) and must come back whole; CI and history read removed
--     orders' invoices. The cost is 51 rows. Challan (ORB) orders are included
--     for the same reason (6 live, invoiceNo NULL — the seq-1 row stays empty).
--   · NO separate index on order_invoices("orderId"): it is the LEADING column
--     of the (orderId, seq) unique, whose index already serves every lookup by
--     order — the ci_return_lines precedent (schema.prisma "no separate index
--     on ciReturnId"). Likewise order_invoice_lines("orderInvoiceId").
--   · invoiceDate is timestamptz, the live type of orders."invoiceDate"
--     (information_schema, 2026-10-10) — so the copy is exact.
--   · NO live_changes trigger yet: nothing on a screen reads these tables in
--     Phase 1. CORE §13 (LIVE FEED): the trigger goes on in the SAME commit as
--     the first screen read (Phase 2).
--   · RLS: left at the Postgres default (off) — the same as orders.
--
-- ── HOW TO RUN ──────────────────────────────────────────────────────────────
--   Supabase SQL Editor. No BEGIN/COMMIT (CORE §3). The editor shows only the
--   LAST result of a paste, so run each PART on its own, in order:
--     PART 1 (read-only) — must show 0 / 0. If either table exists, STOP.
--     PART 2 (DDL)       — the two tables, constraints, indexes.
--     PART 3 (back-fill) — one seq-1 row per order + a fill-null catch-up.
--     PART 4 (read-only) — the verification SELECT.
--   Re-runnable: every object is IF NOT EXISTS; PART 3 skips orders that
--   already have seq 1 (ON CONFLICT on the real unique) and only fills an empty
--   SAP slot. ⚠ IF NOT EXISTS skips an existing object WHATEVER its shape —
--   PART 4 reads the live constraint text back; trust that, not this file.
--   🔴 RE-RUN PART 3 ONCE MORE right after the Phase 1 import code deploys:
--   orders created, and invoices filled by patch-headers, between this run and
--   that deploy have no row / an empty SAP slot until then.
-- ============================================================================


-- ============================================================================
-- PART 1 — RUN FIRST, ALONE. READ-ONLY. Expect: 0, 0.
-- ============================================================================

SELECT 'order_invoices exists'::text AS what,
       count(*)::text                AS value
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'order_invoices'
UNION ALL
SELECT 'order_invoice_lines exists'::text, count(*)::text
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'order_invoice_lines';


-- ============================================================================
-- PART 2 — DDL. The two tables.
-- Constraint / index names are Prisma's defaults for the models step 3b will
-- add, so the schema needs no `map:`.
-- ============================================================================

CREATE TABLE IF NOT EXISTS order_invoices (
  "id"          SERIAL       NOT NULL,
  "orderId"     integer      NOT NULL,
  "invoiceNo"   text,
  "invoiceDate" timestamptz,
  "seq"         integer      NOT NULL,
  "source"      text         NOT NULL,
  "createdById" integer,
  "createdAt"   timestamptz(6) NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz(6) NOT NULL DEFAULT now(),

  CONSTRAINT order_invoices_pkey PRIMARY KEY ("id"),
  -- THE ROW IDENTITY. Also the ON CONFLICT target of PART 3. Never
  -- (orderId, invoiceNo) — see the header (Split load).
  CONSTRAINT "order_invoices_orderId_seq_key" UNIQUE ("orderId", "seq"),
  CONSTRAINT chk_order_invoices_seq_positive CHECK ("seq" >= 1),
  CONSTRAINT chk_order_invoices_source CHECK ("source" IN ('sap', 'manual')),
  -- A typed invoice always has a number; the SAP slot may be empty until SAP
  -- sends one. No blank strings either way (live orders: 0 blank invoiceNo).
  CONSTRAINT chk_order_invoices_manual_has_no CHECK ("source" <> 'manual' OR "invoiceNo" IS NOT NULL),
  CONSTRAINT chk_order_invoices_no_not_blank CHECK ("invoiceNo" IS NULL OR btrim("invoiceNo") <> ''),

  CONSTRAINT "order_invoices_orderId_fkey"
    FOREIGN KEY ("orderId")     REFERENCES orders("id") ON DELETE RESTRICT,
  CONSTRAINT "order_invoices_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES users("id")  ON DELETE SET NULL
);

-- Search by invoice number (Floor / CI / trips find-bill) and the invoice-pair
-- partner map. No separate "orderId" index — see the header.
CREATE INDEX IF NOT EXISTS "order_invoices_invoiceNo_idx" ON order_invoices ("invoiceNo");


CREATE TABLE IF NOT EXISTS order_invoice_lines (
  "id"             SERIAL       NOT NULL,
  "orderInvoiceId" integer      NOT NULL,
  "rawLineItemId"  integer      NOT NULL,
  -- TINS of this raw line on this invoice. Part-qty of one line across two
  -- invoices is allowed (rare); the app keeps the sum ≤ the line's unitQty.
  "qty"            integer      NOT NULL,
  "createdAt"      timestamptz(6) NOT NULL DEFAULT now(),

  CONSTRAINT order_invoice_lines_pkey PRIMARY KEY ("id"),
  CONSTRAINT "order_invoice_lines_orderInvoiceId_rawLineItemId_key" UNIQUE ("orderInvoiceId", "rawLineItemId"),
  CONSTRAINT chk_order_invoice_lines_qty_positive CHECK ("qty" > 0),

  CONSTRAINT "order_invoice_lines_orderInvoiceId_fkey"
    FOREIGN KEY ("orderInvoiceId") REFERENCES order_invoices("id")       ON DELETE CASCADE,
  CONSTRAINT "order_invoice_lines_rawLineItemId_fkey"
    FOREIGN KEY ("rawLineItemId")  REFERENCES import_raw_line_items("id") ON DELETE RESTRICT
);

-- "Which invoice(s) is this raw line on" — the CI and picking-finding lookups.
CREATE INDEX IF NOT EXISTS "order_invoice_lines_rawLineItemId_idx" ON order_invoice_lines ("rawLineItemId");


-- ============================================================================
-- PART 3 — BACK-FILL. One seq-1 'sap' row per order, ALL orders (removed and
-- challan included — see the header). createdById NULL = system.
-- ~18.1k rows (live 2026-10-10: 18,109 orders). Re-runnable.
-- ============================================================================

INSERT INTO order_invoices ("orderId", "invoiceNo", "invoiceDate", "seq", "source", "createdById", "createdAt", "updatedAt")
SELECT o."id", o."invoiceNo", o."invoiceDate", 1, 'sap', NULL, now(), now()
  FROM orders o
ON CONFLICT ("orderId", "seq") DO NOTHING;

-- Catch-up for a re-run: fill an EMPTY SAP slot from orders — the same
-- null-only rule patch-headers uses on orders (app/api/import/obd/route.ts
-- :4473-4481). Never overwrites a number; never touches a manual row.
UPDATE order_invoices oi
   SET "invoiceNo"   = COALESCE(oi."invoiceNo",   o."invoiceNo"),
       "invoiceDate" = COALESCE(oi."invoiceDate", o."invoiceDate"),
       "updatedAt"   = now()
  FROM orders o
 WHERE oi."orderId" = o."id"
   AND oi."seq" = 1
   AND oi."source" = 'sap'
   AND ((oi."invoiceNo" IS NULL AND o."invoiceNo" IS NOT NULL)
     OR (oi."invoiceDate" IS NULL AND o."invoiceDate" IS NOT NULL));


-- ============================================================================
-- PART 4 — RUN LAST, ALONE. READ-ONLY. The verification SELECT.
-- Expect: orders = order_invoices (seq-1 rows); lines 0; both "must be 0" rows
-- 0; then 13 constraint rows (order_invoices 8: pkey, unique, 4 CHECK, 2 FK ·
-- order_invoice_lines 5: pkey, unique, 1 CHECK, 2 FK) and 6 index rows (3 + 3).
-- ⚠ Rows 1 and 5 move if an import lands between PART 3 and PART 4 — re-run
-- PART 3, then PART 4.
-- ============================================================================

SELECT 1 AS k, 'orders (all)'::text AS what, count(*)::text AS value FROM orders
UNION ALL
SELECT 2, 'order_invoices rows', count(*)::text FROM order_invoices
UNION ALL
SELECT 3, 'order_invoices seq-1 rows', count(*)::text FROM order_invoices WHERE "seq" = 1
UNION ALL
SELECT 4, 'order_invoice_lines rows (expect 0)', count(*)::text FROM order_invoice_lines
UNION ALL
SELECT 5, 'orders WITHOUT a seq-1 row (must be 0)', count(*)::text
  FROM orders o
 WHERE NOT EXISTS (SELECT 1 FROM order_invoices oi WHERE oi."orderId" = o."id" AND oi."seq" = 1)
UNION ALL
SELECT 6, 'seq-1 invoiceNo differs from orders.invoiceNo (must be 0)', count(*)::text
  FROM order_invoices oi JOIN orders o ON o."id" = oi."orderId"
 WHERE oi."seq" = 1 AND oi."invoiceNo" IS DISTINCT FROM o."invoiceNo"
UNION ALL
SELECT 7, 'seq-1 invoiceDate differs from orders.invoiceDate (must be 0)', count(*)::text
  FROM order_invoices oi JOIN orders o ON o."id" = oi."orderId"
 WHERE oi."seq" = 1 AND oi."invoiceDate" IS DISTINCT FROM o."invoiceDate"
UNION ALL
SELECT 8, 'seq-1 rows with an invoice', count(*)::text FROM order_invoices WHERE "seq" = 1 AND "invoiceNo" IS NOT NULL
UNION ALL
SELECT 10, c.conrelid::regclass::text || ' · ' || c.conname::text, pg_get_constraintdef(c.oid)::text
  FROM pg_constraint c
 WHERE c.conrelid IN ('public.order_invoices'::regclass, 'public.order_invoice_lines'::regclass)
UNION ALL
SELECT 20, 'index · ' || indexname::text, indexdef::text
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename IN ('order_invoices', 'order_invoice_lines')
ORDER BY 1, 2;
