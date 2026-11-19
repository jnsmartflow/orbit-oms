-- sql/2026-11-19-v27.81-order-invoices-ship-to.sql
-- v27.81 · 2026-11-19 · Split load PER-PART SHIP-TO · REVERSES MODEL A FOR SHIP-TO
-- (owner decision 2026-11-19; plan docs/prompts/drafts/code-plan-2026-11-19-split-load-per-part-ship-to.md §A).
-- Cancel, Hand, picking and tint stay per OBD. Only ship-to moves to the part.
--
-- NOT RUN until the owner pastes it into the Supabase SQL Editor (Smart Flow). One paste, no BEGIN/COMMIT.
--
-- Gate 0 (owner, 2026-11-19, live pg_constraint read):
--   chk_orders_ship_to_text      = CHECK ("shipToText" IS NULL OR "shipToText" ~ '\S'::text)
--   chk_orders_ship_to_text_area = CHECK ("shipToText" IS NULL OR "shipToAreaId" IS NOT NULL)
--   orders_shipToOverrideCustomerId_fkey → delivery_point_master(id), no ON DELETE clause (NO ACTION)
--   orders_shipToAreaId_fkey             → area_master(id), no ON DELETE clause (NO ACTION)
--   order_invoices + ship_to_copies live triggers all enabled ('O'); no name clashes.
--   ⚠ DRIFT: orders."shipToOverride" is boolean NULLABLE DEFAULT false live (Prisma says NOT NULL).
--     Not touched here; PART 3 counts it.
--
-- order_invoices."shipToOverride" is a TRI-STATE:
--   NULL  = inherit the OBD's four orders columns (default; every existing row)
--   TRUE  = the part's own redirect: exactly one of a dealer id OR a typed name (+ area)
--   FALSE = the part's own reset: SAP's own site, even when the OBD is redirected
--
-- Live feed: no trigger work. trg_live_changes_order_invoices_upd (v27.65) fires on any column update;
-- trg_live_changes_ship_to_copies_* already key on "orderId".

-- PART 1 — order_invoices: four nullable ship-to columns, two FKs (mirroring orders), five CHECKs
ALTER TABLE order_invoices
  ADD COLUMN "shipToOverride"           boolean NULL,
  ADD COLUMN "shipToOverrideCustomerId" integer NULL,
  ADD COLUMN "shipToText"               text    NULL,
  ADD COLUMN "shipToAreaId"             integer NULL,
  ADD CONSTRAINT "order_invoices_shipToOverrideCustomerId_fkey"
      FOREIGN KEY ("shipToOverrideCustomerId") REFERENCES delivery_point_master(id),
  ADD CONSTRAINT "order_invoices_shipToAreaId_fkey"
      FOREIGN KEY ("shipToAreaId") REFERENCES area_master(id),
  -- mirrored from orders (Gate 0 live text)
  ADD CONSTRAINT chk_order_invoices_ship_to_text
      CHECK (("shipToText" IS NULL) OR ("shipToText" ~ '\S'::text)),
  ADD CONSTRAINT chk_order_invoices_ship_to_text_area
      CHECK (("shipToText" IS NULL) OR ("shipToAreaId" IS NOT NULL)),
  -- part-only (no legacy rows to grandfather)
  ADD CONSTRAINT chk_order_invoices_ship_to_inherit
      CHECK (("shipToOverride" IS TRUE)
             OR ("shipToOverrideCustomerId" IS NULL AND "shipToText" IS NULL AND "shipToAreaId" IS NULL)),
  ADD CONSTRAINT chk_order_invoices_ship_to_one_target
      CHECK (("shipToOverride" IS NOT TRUE)
             OR (("shipToOverrideCustomerId" IS NULL) <> ("shipToText" IS NULL))),
  ADD CONSTRAINT chk_order_invoices_area_only_typed
      CHECK (("shipToAreaId" IS NULL) OR ("shipToText" IS NOT NULL));

CREATE INDEX "order_invoices_shipToOverrideCustomerId_idx" ON order_invoices ("shipToOverrideCustomerId");
CREATE INDEX "order_invoices_shipToAreaId_idx"             ON order_invoices ("shipToAreaId");

-- PART 2 — ship_to_copies: a Floor copy may belong to ONE part (NULL = the OBD, today's meaning)
-- ON DELETE SET NULL: a merge / repair that deletes a part drops its copies back to the OBD.
ALTER TABLE ship_to_copies
  ADD COLUMN "orderInvoiceId" integer NULL,
  ADD CONSTRAINT "ship_to_copies_orderInvoiceId_fkey"
      FOREIGN KEY ("orderInvoiceId") REFERENCES order_invoices(id) ON DELETE SET NULL,
  ADD CONSTRAINT chk_ship_to_copies_part_has_order
      CHECK (("orderInvoiceId" IS NULL) OR ("orderId" IS NOT NULL));

CREATE INDEX "ship_to_copies_orderInvoiceId_idx" ON ship_to_copies ("orderInvoiceId");

-- PART 3 — read-back: ONE statement (the SQL Editor shows only the last result).
-- Expect: 5 'col' rows · 9 'con' rows (2 FK + 5 CHECK on order_invoices, 1 FK + 1 CHECK on ship_to_copies)
--         · 3 'idx' rows · 'part_set' = 0 · 'copies_on_part' = 0 · 'oi_rows' = the pre-run count
--         · 'orders_override_null' / 'orders_override_true' = the drift baseline (recorded, not fixed here).
SELECT 'col'::text AS k, (table_name || '.' || column_name || ' ' || data_type || ' nullable=' || is_nullable)::text AS v
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('order_invoices', 'ship_to_copies')
   AND column_name IN ('shipToOverride', 'shipToOverrideCustomerId', 'shipToText', 'shipToAreaId', 'orderInvoiceId')
UNION ALL
SELECT 'con'::text, (conname || ' = ' || pg_get_constraintdef(oid))::text
  FROM pg_constraint
 WHERE conname IN ('order_invoices_shipToOverrideCustomerId_fkey', 'order_invoices_shipToAreaId_fkey',
                   'chk_order_invoices_ship_to_text', 'chk_order_invoices_ship_to_text_area',
                   'chk_order_invoices_ship_to_inherit', 'chk_order_invoices_ship_to_one_target',
                   'chk_order_invoices_area_only_typed',
                   'ship_to_copies_orderInvoiceId_fkey', 'chk_ship_to_copies_part_has_order')
UNION ALL
SELECT 'idx'::text, indexname::text
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND indexname IN ('order_invoices_shipToOverrideCustomerId_idx', 'order_invoices_shipToAreaId_idx',
                     'ship_to_copies_orderInvoiceId_idx')
UNION ALL
SELECT 'part_set'::text, COUNT(*)::text FROM order_invoices WHERE "shipToOverride" IS NOT NULL
UNION ALL
SELECT 'copies_on_part'::text, COUNT(*)::text FROM ship_to_copies WHERE "orderInvoiceId" IS NOT NULL
UNION ALL
SELECT 'oi_rows'::text, COUNT(*)::text FROM order_invoices
UNION ALL
SELECT 'orders_override_null'::text, COUNT(*)::text FROM orders WHERE "shipToOverride" IS NULL
UNION ALL
SELECT 'orders_override_true'::text, COUNT(*)::text FROM orders WHERE "shipToOverride" IS TRUE
ORDER BY 1, 2;
