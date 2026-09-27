// lib/picking/pick-deleted.ts
//
// Today's pick-deleted bills for the Picking boards (2026-09-27, build step 8).
//
// Billing's Pick delete (lib/billing/pick-delete.ts) cancels one bill of a
// same-SO group, which drops it out of buildPickingWhere() (every branch pins
// dispatchStatus 'dispatch') and deletes its pick_assignments row — so the
// picker would lose it without a word. This read keeps it visible, read-only,
// until the end of the IST day, as a SIBLING list (PickDeletedCard), never a
// queue row.
//
// 🔴 NOT a widening of the queue: only TODAY's ACTIVE pick_delete decisions are
// read, and only while the bill is STILL cancelled. An Undo (undoneAt set), a
// restore elsewhere (no longer cancelled) or midnight IST takes it off.
//
// Scoped for a picker by the picker id SAVED ON THE DECISION (deletedPickerId),
// because the assignment row is gone. A bill nobody held has deletedPickerId
// null and so shows on the supervisor board only.
//
// Two batched reads per queue build, sequential awaits, never
// prisma.$transaction (CORE §3). Read-only.

import { prisma } from "@/lib/prisma";
import { getISTDayRange } from "@/lib/dates";
import type { PickDeletedCard } from "./types";

const DEALER = {
  select: {
    customerName: true,
    area: { select: { primaryRoute: { select: { name: true } }, deliveryType: { select: { name: true } } } },
  },
} as const;

function nonBlank(s: string | null | undefined): string | null {
  return s !== null && s !== undefined && s.trim() !== "" ? s : null;
}

export async function getPickDeletedToday(options: { pickerId?: number } = {}): Promise<PickDeletedCard[]> {
  const { start, end } = getISTDayRange();

  const decisions = await prisma.pick_delete_decisions.findMany({
    where: {
      kind: "pick_delete",
      undoneAt: null,
      decidedAt: { gte: start, lt: end },
      deletedOrder: { workflowStage: "cancelled", isRemoved: false },
      ...(options.pickerId !== undefined ? { deletedPickerId: options.pickerId } : {}),
    },
    orderBy: [{ decidedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      deletedOrderId: true,
      deletedPickerId: true,
      keptOrderIds: true,
      decidedAt: true,
      deletedPicker: { select: { name: true } },
      deletedOrder: {
        select: {
          obdNumber: true,
          shipToCustomerName: true,
          customer: DEALER,
          shipToOverrideCustomer: DEALER,
        },
      },
    },
  });
  if (decisions.length === 0) return [];

  // The survivors, read LIVE: a kept bill cancelled or removed since is not a
  // "correct pick" any more.
  const keptIds = Array.from(new Set(decisions.flatMap((d) => d.keptOrderIds)));
  const kept =
    keptIds.length > 0
      ? await prisma.orders.findMany({
          where: { id: { in: keptIds }, isRemoved: false, workflowStage: { not: "cancelled" } },
          select: { id: true, obdNumber: true },
        })
      : [];
  const obdById = new Map(kept.map((k) => [k.id, k.obdNumber]));

  const cards: PickDeletedCard[] = [];
  for (const d of decisions) {
    const o = d.deletedOrder;
    if (d.deletedOrderId === null || o === null) continue;
    const dealer = o.shipToOverrideCustomer ?? o.customer;
    cards.push({
      decisionId: d.id,
      orderId: d.deletedOrderId,
      obdNumber: o.obdNumber,
      // The queue's own chain (lib/picking/queue.ts): override, customer, SAP name.
      dealerName:
        nonBlank(o.shipToOverrideCustomer?.customerName) ??
        nonBlank(o.customer?.customerName) ??
        nonBlank(o.shipToCustomerName) ??
        "(Unmatched)",
      route: dealer?.area?.primaryRoute?.name ?? null,
      deliveryType: dealer?.area?.deliveryType?.name ?? null,
      pickerId: d.deletedPickerId,
      pickerName: d.deletedPicker?.name ?? null,
      correctObds: d.keptOrderIds
        .map((id) => obdById.get(id))
        .filter((x): x is string => x !== undefined),
      decidedAt: d.decidedAt.toISOString(),
    });
  }
  return cards;
}
