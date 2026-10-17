-- ============================================================================
-- 2026-10-17 · PART 7 GATE CHECKS — READ-ONLY. Run BEFORE PART 7 of
-- sql/2026-10-12-order-invoices-dispatch-unit.sql (SET NOT NULL on both
-- "orderInvoiceId" columns + DROP the two old (tripId, orderId) uniques).
--
-- One SELECT, nothing written. Safe to run any time, as often as you like.
-- The editor shows the whole result (one statement).
--
-- Since P5-4 every reader and writer of trip_bill_copies / trip_redeliveries
-- keys on "orderInvoiceId" (lib/order-invoices/links.ts recordsOfObds /
-- recordObdOf / linkRowFor). PART 7 is safe when:
--   k 1-2   NULL "orderInvoiceId" ......................... 0 / 0   (else SET NOT NULL fails)
--   k 3-4   orderId ≠ its invoice row's orderId ............ 0 / 0   (else readers that join
--                                                                    through the row see a
--                                                                    different OBD than orderId)
--   k 5-6   duplicate ("tripId","orderInvoiceId") .......... 0 / 0   (the new unique already
--                                                                    forbids it — a guard)
--   k 7-8   total rows (context, moves with use) ........... copies 857 · re-deliveries 56
--   k 20    constraints — 9 on trip_bill_copies, 11 on trip_redeliveries:
--             <t>_pkey · <t>_trip_order_key UNIQUE ("tripId","orderId")  ← OLD, PART 7 drops it
--             <t>_trip_invoice_key UNIQUE ("tripId","orderInvoiceId")     ← NEW, stays
--             <t>_order_invoice_fkey (RESTRICT) · <t>_order_fkey · <t>_trip_fkey (RESTRICT)
--             trip_bill_copies:  + copied_by_fkey, chk_..._actor, chk_..._kind
--             trip_redeliveries: + created_by_fkey, drop_fkey (RESTRICT), prev_trip_fkey,
--                                  chk_..._attempt, chk_..._reason
-- Live 2026-10-17 (read-only, at the P5-4 commit): k 1-6 all 0 · k 7 857 · k 8 56 ·
-- k 20 9 + 11 rows exactly as above. After PART 7: k 20 drops the two _trip_order_key
-- rows (8 + 10), k 1-2 can no longer be anything but 0.
-- ============================================================================

SELECT 1 AS k, 'trip_bill_copies NULL orderInvoiceId (must be 0)'::text AS what, count(*)::text AS value
  FROM trip_bill_copies WHERE "orderInvoiceId" IS NULL
UNION ALL
SELECT 2, 'trip_redeliveries NULL orderInvoiceId (must be 0)', count(*)::text
  FROM trip_redeliveries WHERE "orderInvoiceId" IS NULL
UNION ALL
SELECT 3, 'trip_bill_copies orderId <> invoice row orderId (must be 0)', count(*)::text
  FROM trip_bill_copies c JOIN order_invoices oi ON oi.id = c."orderInvoiceId"
 WHERE oi."orderId" <> c."orderId"
UNION ALL
SELECT 4, 'trip_redeliveries orderId <> invoice row orderId (must be 0)', count(*)::text
  FROM trip_redeliveries r JOIN order_invoices oi ON oi.id = r."orderInvoiceId"
 WHERE oi."orderId" <> r."orderId"
UNION ALL
SELECT 5, 'trip_bill_copies duplicate (tripId, orderInvoiceId) (must be 0)', count(*)::text
  FROM (SELECT 1 FROM trip_bill_copies WHERE "orderInvoiceId" IS NOT NULL
         GROUP BY "tripId", "orderInvoiceId" HAVING count(*) > 1) d
UNION ALL
SELECT 6, 'trip_redeliveries duplicate (tripId, orderInvoiceId) (must be 0)', count(*)::text
  FROM (SELECT 1 FROM trip_redeliveries WHERE "orderInvoiceId" IS NOT NULL
         GROUP BY "tripId", "orderInvoiceId" HAVING count(*) > 1) d
UNION ALL
SELECT 7, 'trip_bill_copies rows (context)', count(*)::text FROM trip_bill_copies
UNION ALL
SELECT 8, 'trip_redeliveries rows (context)', count(*)::text FROM trip_redeliveries
UNION ALL
SELECT 20, c.conrelid::regclass::text || ' · ' || c.conname::text, pg_get_constraintdef(c.oid)::text
  FROM pg_constraint c
 WHERE c.conrelid IN ('public.trip_bill_copies'::regclass, 'public.trip_redeliveries'::regclass)
ORDER BY 1, 2;
