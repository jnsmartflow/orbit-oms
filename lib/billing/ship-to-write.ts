// lib/billing/ship-to-write.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 BILLING'S SHIP-TO WRITE — the mail order, then every bill on its SO
// ═══════════════════════════════════════════════════════════════════════════
//
// Extracted from app/api/billing/mail-order/actions/route.ts's shipTo branch
// (2026-10-19, free-text ship-to P1) so the old JSON action (the ✎ pencil,
// dealer / clear) and the new multipart save (POST /api/billing/mail-order/
// ship-to — dealer / typed / reset + copies) write ONE way.
//
// The two writes, in this order, sequential awaits, never $transaction (CORE §3):
//   1. mo_orders — the INTENT, always saved. Enrichment carries it to bills
//      that import later (app/api/import/obd/route.ts, fill-only).
//   2. orders — PER BILL on the SO: billingRefusal("shipTo") (dispatched,
//      cancelled, on a trip incl. a partial invoice-trip → refused), a repeat
//      is skipped, then ONE orders.update + ONE order_status_logs row per bill.
//      Challan-linked bills are left out of the read (NOT_CHALLAN_LINKED).
//
// Columns: lib/floor/ship-to.ts shipToColumns — the same last-save-wins shape
// Floor writes. Dealer and Reset also SOFT-REMOVE the mail order's active
// copies (the file stays in the bucket).
//
// 🔴 THE soNumber GUARD IS LOAD-BEARING. `where: { soNumber: null }` would
// match every un-punched order. Write 2 is skipped entirely for a blank SO.
//
// Server-only (Prisma).

import { prisma } from "@/lib/prisma";
import { billingRefusal } from "@/lib/billing/refusal";
import { INVOICE_TRIPS_SELECT, invoiceTripsOf } from "@/lib/order-invoices/trip-refusal";
import { NOT_CHALLAN_LINKED } from "@/lib/workflow-stages";
import { shipToColumns, type ShipToTarget } from "@/lib/floor/ship-to";
import { activeOwnCopiesWhere, softRemoveCopies } from "@/lib/ship-to/copies-server";

/** One bill the per-bill write did NOT change, and why — reported to the bar. */
export interface BillingBillOutcome {
  orderId: number;
  obdNumber: string;
  reason: string;
}

/** The mail order fields returned to the client after a ship-to save. */
export const BILLING_SHIP_TO_MO_SELECT = {
  id: true,
  dispatchStatus: true,
  dispatchPriority: true,
  shipToOverride: true,
  shipToOverrideCustomerId: true,
  shipToText: true,
  shipToAreaId: true,
  dispatchTargetDate: true,
  dispatchWindowId: true,
  handAt: true,
  billOnlyAt: true,
} as const;

function billNote(target: ShipToTarget, text: string | null): string {
  if (target.kind === "dealer") return "Ship-to changed from billing";
  if (target.kind === "typed") return `Ship-to typed from billing: ${text}`;
  return "Ship-to redirect cleared from billing";
}

/**
 * Write 1 + write 2 for one mail order. The caller has already checked the
 * gates, the lock and the target (dealer exists / area active). Throws only if
 * write 1 throws — a bill that fails lands in `failed`, as before.
 */
export async function applyBillingShipTo(args: {
  moOrderId: number;
  soNumber: string | null;
  target: ShipToTarget;
  userId: number;
}) {
  const { moOrderId, target, userId } = args;
  const next = shipToColumns(target);

  // ── WRITE 1 — the intent, on the mail order. ─────────────────────────────
  const moOrder = await prisma.mo_orders.update({
    where: { id: moOrderId },
    data: next,
    select: BILLING_SHIP_TO_MO_SELECT,
  });

  if (target.kind !== "typed") {
    await softRemoveCopies(activeOwnCopiesWhere("billing", moOrderId), userId);
  }

  // ── WRITE 2 — per bill, if any exist yet. ────────────────────────────────
  const updated: number[] = [];
  const skipped: BillingBillOutcome[] = [];
  const failed: BillingBillOutcome[] = [];

  const soNumber = args.soNumber?.trim();
  if (soNumber) {
    const bills = await prisma.orders.findMany({
      // isRemoved: false — soft-delete read rule (CORE §3). NOT_CHALLAN_LINKED
      // (Challan orders slice 2): a bill linked to a challan order is never
      // written by this SO-keyed path, and is not even reported as skipped.
      where: { soNumber, isRemoved: false, ...NOT_CHALLAN_LINKED },
      orderBy: { id: "asc" },
      select: {
        id: true,
        obdNumber: true,
        workflowStage: true,
        shipToOverride: true,
        shipToOverrideCustomerId: true,
        shipToText: true,
        shipToAreaId: true,
        tripDropId: true,
        tripDrop: { select: { trip: { select: { tripNumber: true } } } },
        // Each invoice row's trip — the partly-on-a-trip message (Phase 5 commit 2).
        invoices: INVOICE_TRIPS_SELECT,
      },
    });

    for (const bill of bills) {
      try {
        const refusal = billingRefusal(
          "shipTo",
          {
            workflowStage: bill.workflowStage,
            isRemoved: false,
            tripDropId: bill.tripDropId,
            tripNumber: bill.tripDrop?.trip.tripNumber ?? null,
            invoiceTrips: invoiceTripsOf(bill.invoices),
          },
          target.kind === "reset" ? "clear" : "set",
        );
        if (refusal !== null) {
          failed.push({ orderId: bill.id, obdNumber: bill.obdNumber, reason: refusal });
          continue;
        }
        const isRepeat =
          bill.shipToOverride === next.shipToOverride &&
          bill.shipToOverrideCustomerId === next.shipToOverrideCustomerId &&
          bill.shipToText === next.shipToText &&
          bill.shipToAreaId === next.shipToAreaId;
        if (isRepeat) {
          skipped.push({ orderId: bill.id, obdNumber: bill.obdNumber, reason: "already set" });
          continue;
        }

        // ONE orders.update + ONE log per bill (the live-sync markers key on
        // MAX(orders.updatedAt) — a second write fires a false "changed").
        await prisma.orders.update({ where: { id: bill.id }, data: next });
        await prisma.order_status_logs.create({
          data: {
            orderId: bill.id,
            fromStage: bill.workflowStage,
            // No ship-to change moves a stage; the NOTE identifies the event.
            toStage: bill.workflowStage,
            changedById: userId,
            note: billNote(target, next.shipToText),
          },
        });
        updated.push(bill.id);
      } catch (err) {
        failed.push({
          orderId: bill.id,
          obdNumber: bill.obdNumber,
          reason: err instanceof Error ? err.message : "Unexpected error",
        });
      }
    }
  }

  return { moOrder, updated, skipped, failed };
}
