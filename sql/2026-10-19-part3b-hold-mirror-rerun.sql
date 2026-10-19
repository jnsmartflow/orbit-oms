-- ============================================================================
-- 2026-10-19 · RE-RUN of PART 3b (hold mirror) of
-- sql/2026-10-12-order-invoices-dispatch-unit.sql — after the 6.1 deploy.
-- Add invoices 6.1 ("hold / release per invoice", lib/order-invoices/hold.ts).
-- No DDL. UNSPLIT OBDs ONLY (exactly one row, no lines); split OBDs are never
-- touched here (their rows ARE the truth since 6.1).
--
-- WHY. Nothing wrote order_invoices."isHeld" between the v27.66 back-fill
-- (2026-10-12) and 6.1, so the unsplit rows drifted from orders."dispatchStatus".
-- From 6.1 every OBD-level hold / release / cancel writer mirrors the rows
-- (mirrorObdHold), so ONE re-run now closes the gap for good.
--
-- 🔴 RUN ONLY AFTER 6.1 IS DEPLOYED (live on orbitoms.in), never before: the old
-- code does not mirror, so a run before the deploy would drift again.
--
-- Evidence (read-only, 2026-10-19, before 6.1):
--   unsplit hold drift 196 = 75 rows to hold (OBD 'hold', row false)
--                          + 121 rows to clear (OBD not 'hold', row true)
--   40 of the 75 sit on an OBD at pending_support whose seq-1 row still says
--   "isDispatched" true (all 40 orders last updated 2026-10-13 03:35:59 UTC —
--   one bulk write moved them off 'dispatched'). Holding those rows while they
--   say dispatched violates chk_order_invoices_held_not_dispatched, so PART 2
--   mirrors the DISPATCHED half first (the spec's PART 3c, verbatim — 123 rows
--   drifted on it). Dispatched is not dual-written yet (Phase 6.2+): PART 2 is a
--   catch-up, re-runnable, and harmless to re-run later.
--   split OBDs drifted: 0.
--
-- HOW TO RUN (Smart Flow, Supabase SQL Editor): each PART on its own, in order.
-- No BEGIN/COMMIT. Every write is an IS DISTINCT FROM mirror → re-running is a
-- no-op. The order_invoices live triggers fire one 'order' line per changed row
-- (≈ 320 lines, statement-level) — expected. Never with
-- session_replication_role = replica (CORE §13).
--   ⏭ To fix ONLY the hold half and leave those 40: skip PART 2; PART 3's guard
--   then leaves them, and PART 4 row 3 shows 40.
-- ============================================================================


-- ============================================================================
-- PART 1 — READ-ONLY PRE-CHECK. Expect (moves with use): hold to_true ~75 ·
-- to_false ~121 · blocked_by_dispatched ~40 · dispatched_drift ~123 ·
-- split_hold_drift 0.
-- ============================================================================
SELECT 1 AS k, 'hold to_true (OBD hold, row not held)'::text AS what, count(*)::text AS value
  FROM order_invoices oi JOIN orders o ON o.id = oi."orderId"
 WHERE oi.seq = 1
   AND NOT EXISTS (SELECT 1 FROM order_invoices x WHERE x."orderId" = oi."orderId" AND x.seq <> 1)
   AND NOT EXISTS (SELECT 1 FROM order_invoice_lines l WHERE l."orderInvoiceId" = oi.id)
   AND o."dispatchStatus" = 'hold' AND NOT oi."isHeld"
UNION ALL
SELECT 2, 'hold to_false (OBD not hold, row held)', count(*)::text
  FROM order_invoices oi JOIN orders o ON o.id = oi."orderId"
 WHERE oi.seq = 1
   AND NOT EXISTS (SELECT 1 FROM order_invoices x WHERE x."orderId" = oi."orderId" AND x.seq <> 1)
   AND NOT EXISTS (SELECT 1 FROM order_invoice_lines l WHERE l."orderInvoiceId" = oi.id)
   AND o."dispatchStatus" IS DISTINCT FROM 'hold' AND oi."isHeld"
UNION ALL
SELECT 3, 'blocked_by_dispatched (to_true rows still isDispatched)', count(*)::text
  FROM order_invoices oi JOIN orders o ON o.id = oi."orderId"
 WHERE oi.seq = 1
   AND NOT EXISTS (SELECT 1 FROM order_invoices x WHERE x."orderId" = oi."orderId" AND x.seq <> 1)
   AND NOT EXISTS (SELECT 1 FROM order_invoice_lines l WHERE l."orderInvoiceId" = oi.id)
   AND o."dispatchStatus" = 'hold' AND NOT oi."isHeld" AND oi."isDispatched"
UNION ALL
SELECT 4, 'dispatched_drift (unsplit, row vs stage)', count(*)::text
  FROM order_invoices oi JOIN orders o ON o.id = oi."orderId"
 WHERE oi.seq = 1
   AND NOT EXISTS (SELECT 1 FROM order_invoices x WHERE x."orderId" = oi."orderId" AND x.seq <> 1)
   AND NOT EXISTS (SELECT 1 FROM order_invoice_lines l WHERE l."orderInvoiceId" = oi.id)
   AND oi."isDispatched" IS DISTINCT FROM (o."workflowStage" = 'dispatched')
UNION ALL
SELECT 5, 'split_hold_drift (never touched here; info)', count(*)::text
  FROM order_invoices oi JOIN orders o ON o.id = oi."orderId"
 WHERE (oi.seq <> 1
        OR EXISTS (SELECT 1 FROM order_invoices x WHERE x."orderId" = oi."orderId" AND x.seq <> 1)
        OR EXISTS (SELECT 1 FROM order_invoice_lines l WHERE l."orderInvoiceId" = oi.id))
   AND oi."isHeld" IS DISTINCT FROM (o."dispatchStatus" IS NOT DISTINCT FROM 'hold')
ORDER BY 1;


-- ============================================================================
-- PART 2 — DISPATCHED MIRROR (the spec's PART 3c, verbatim). Unsplit only.
-- Expect ≈ PART 1 row 4 (~123) rows. dispatchedAt / ById from the LATEST
-- toStage='dispatched' status log where one exists, else NULL; a row that is no
-- longer dispatched loses its stamps (chk_order_invoices_dispatch_shape).
-- ============================================================================
UPDATE order_invoices oi
   SET "isDispatched"   = (o."workflowStage" = 'dispatched'),
       "dispatchedAt"   = CASE WHEN o."workflowStage" = 'dispatched' THEN lg."createdAt"   END,
       "dispatchedById" = CASE WHEN o."workflowStage" = 'dispatched' THEN lg."changedById" END,
       "updatedAt" = now()
  FROM orders o
  LEFT JOIN LATERAL (
    SELECT l."createdAt", l."changedById"
      FROM order_status_logs l
     WHERE l."orderId" = o.id AND l."toStage" = 'dispatched'
     ORDER BY l."createdAt" DESC, l.id DESC
     LIMIT 1
  ) lg ON true
 WHERE oi."orderId" = o.id
   AND oi.seq = 1
   AND NOT EXISTS (SELECT 1 FROM order_invoices x WHERE x."orderId" = oi."orderId" AND x.seq <> 1)
   AND NOT EXISTS (SELECT 1 FROM order_invoice_lines l2 WHERE l2."orderInvoiceId" = oi.id)
   AND oi."isDispatched" IS DISTINCT FROM (o."workflowStage" = 'dispatched');


-- ============================================================================
-- PART 3 — HOLD MIRROR (the spec's PART 3b + ONE guard). Unsplit only.
-- Expect ≈ PART 1 rows 1 + 2 (~196) after PART 2; ~156 if PART 2 was skipped.
-- heldAt / heldById stay NULL on a mirrored hold (wall-clock unknown here; the
-- On hold tab keeps the hold-log ladder for unsplit bills). A row no longer held
-- loses its stamps (chk_order_invoices_hold_shape).
-- Guard: never hold a row that still says dispatched
-- (chk_order_invoices_held_not_dispatched) — a no-op once PART 2 has run.
-- ============================================================================
UPDATE order_invoices oi
   SET "isHeld"   = (o."dispatchStatus" IS NOT DISTINCT FROM 'hold'),
       "heldAt"   = CASE WHEN o."dispatchStatus" IS NOT DISTINCT FROM 'hold' THEN oi."heldAt"   END,
       "heldById" = CASE WHEN o."dispatchStatus" IS NOT DISTINCT FROM 'hold' THEN oi."heldById" END,
       "updatedAt" = now()
  FROM orders o
 WHERE oi."orderId" = o.id
   AND oi.seq = 1
   AND NOT EXISTS (SELECT 1 FROM order_invoices x WHERE x."orderId" = oi."orderId" AND x.seq <> 1)
   AND NOT EXISTS (SELECT 1 FROM order_invoice_lines l WHERE l."orderInvoiceId" = oi.id)
   AND oi."isHeld" IS DISTINCT FROM (o."dispatchStatus" IS NOT DISTINCT FROM 'hold')
   AND NOT (o."dispatchStatus" IS NOT DISTINCT FROM 'hold' AND oi."isDispatched");


-- ============================================================================
-- PART 4 — READ-ONLY VERIFY. Expect 0 · 0 · 0 · 0 (row 3 = 40 if PART 2 was
-- skipped) and row 5 unchanged from PART 1.
-- ============================================================================
SELECT 1 AS k, 'hold to_true left (must be 0)'::text AS what, count(*)::text AS value
  FROM order_invoices oi JOIN orders o ON o.id = oi."orderId"
 WHERE oi.seq = 1
   AND NOT EXISTS (SELECT 1 FROM order_invoices x WHERE x."orderId" = oi."orderId" AND x.seq <> 1)
   AND NOT EXISTS (SELECT 1 FROM order_invoice_lines l WHERE l."orderInvoiceId" = oi.id)
   AND o."dispatchStatus" = 'hold' AND NOT oi."isHeld" AND NOT oi."isDispatched"
UNION ALL
SELECT 2, 'hold to_false left (must be 0)', count(*)::text
  FROM order_invoices oi JOIN orders o ON o.id = oi."orderId"
 WHERE oi.seq = 1
   AND NOT EXISTS (SELECT 1 FROM order_invoices x WHERE x."orderId" = oi."orderId" AND x.seq <> 1)
   AND NOT EXISTS (SELECT 1 FROM order_invoice_lines l WHERE l."orderInvoiceId" = oi.id)
   AND o."dispatchStatus" IS DISTINCT FROM 'hold' AND oi."isHeld"
UNION ALL
SELECT 3, 'held OBD, row still isDispatched (0; 40 if PART 2 skipped)', count(*)::text
  FROM order_invoices oi JOIN orders o ON o.id = oi."orderId"
 WHERE oi.seq = 1
   AND NOT EXISTS (SELECT 1 FROM order_invoices x WHERE x."orderId" = oi."orderId" AND x.seq <> 1)
   AND NOT EXISTS (SELECT 1 FROM order_invoice_lines l WHERE l."orderInvoiceId" = oi.id)
   AND o."dispatchStatus" = 'hold' AND NOT oi."isHeld" AND oi."isDispatched"
UNION ALL
SELECT 4, 'dispatched_drift left (0 after PART 2)', count(*)::text
  FROM order_invoices oi JOIN orders o ON o.id = oi."orderId"
 WHERE oi.seq = 1
   AND NOT EXISTS (SELECT 1 FROM order_invoices x WHERE x."orderId" = oi."orderId" AND x.seq <> 1)
   AND NOT EXISTS (SELECT 1 FROM order_invoice_lines l WHERE l."orderInvoiceId" = oi.id)
   AND oi."isDispatched" IS DISTINCT FROM (o."workflowStage" = 'dispatched')
UNION ALL
SELECT 5, 'split_hold_drift (unchanged — info)', count(*)::text
  FROM order_invoices oi JOIN orders o ON o.id = oi."orderId"
 WHERE (oi.seq <> 1
        OR EXISTS (SELECT 1 FROM order_invoices x WHERE x."orderId" = oi."orderId" AND x.seq <> 1)
        OR EXISTS (SELECT 1 FROM order_invoice_lines l WHERE l."orderInvoiceId" = oi.id))
   AND oi."isHeld" IS DISTINCT FROM (o."dispatchStatus" IS NOT DISTINCT FROM 'hold')
ORDER BY 1;
