// lib/billing/sync.ts — POST /api/billing/sync, the server half (live feed billing 2b-i, 2026-09-30).
//
// Plan: docs/prompts/drafts/code-plan-2026-09-30-billing-live-feed.md §D ("One glance, one classifier
// call"), decisions 6-7. Pure rules: lib/billing/sync-rule.ts. Route: app/api/billing/sync/route.ts.
//
// One call per feed glance that carried changes. It answers, per Billing arm the caller may see,
// "could this batch have moved what you show?" (touched) and, ONLY for touched arms, the fresh pill
// count — computed by the SAME function that arm's marker route calls (imported, never re-declared):
//   picking    → countBillingPending        (lib/billing/marker-counts.ts; /api/billing/picking/marker)
//   print      → getPrintCount              (lib/billing/marker-counts.ts; /api/billing/print/marker)
//   telephonic → getTelephonicMarker().count (lib/billing/telephonic.ts; /api/billing/telephonic/marker)
//   pickDelete → getPickDeleteMarker().count (lib/billing/pick-delete.ts; /api/billing/pick-delete/marker)
//   mailOrders → touched only (the Orders tab's count is derived client-side from its own list)
//
// Cost when nothing of Billing's is touched: at most FIVE small statements, each keyed by the
// changed ids (orders by PK · order rows per SO on idx_orders_sonumber · so_tag_matches by
// so_tag_matches_orderId_idx · trips by PK with one EXISTS on trip_activity · changed orders by PK
// joined to their trip, Print v2) — each read only when an arm that needs it is permitted and there
// are ids to ask about. Sequential awaits (CORE §3).

import { prisma } from "@/lib/prisma";
import { getISTDayRange } from "@/lib/dates";
import { countBillingPending, getPrintCount } from "@/lib/billing/marker-counts";
import { getTelephonicMarker } from "@/lib/billing/telephonic";
import { getPickDeleteMarker } from "@/lib/billing/pick-delete";
import { TRIP_SENT_TO_BILLING, TRIP_TAKEN_BACK_FROM_BILLING } from "@/lib/trips/activity";
import {
  pickDeleteTouched,
  pickingTouched,
  printTouched,
  telephonicTouched,
  type OrderFact,
  type SyncBody,
} from "@/lib/billing/sync-rule";

/** Which arms the caller may see — each exactly its marker route's gate (canView on its key). */
export interface SyncArms {
  picking: boolean;
  print: boolean;
  telephonic: boolean;
  pickDelete: boolean;
  mailOrders: boolean;
}

export interface SyncTouched {
  picking: boolean;
  print: boolean;
  telephonic: boolean;
  pickDelete: boolean;
  mailOrders: boolean;
}

export interface SyncResult {
  touched: SyncTouched;
  /** Only the touched (and permitted) arms. */
  counts: Partial<Record<"picking" | "print" | "telephonic" | "pickDelete", number>>;
}

/** Classify only — no counts. Exported for the parity script. */
export async function classifyBillingSync(body: SyncBody, arms: SyncArms): Promise<SyncTouched> {
  const { orderIds, tripIds } = body;
  const needOrderFacts = orderIds.length > 0 && (arms.picking || arms.pickDelete);

  // 1. The changed orders (PK).
  const facts: OrderFact[] = needOrderFacts
    ? await prisma.orders.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, soNumber: true, workflowStage: true, invoicedAt: true },
      })
    : [];

  // 2. Pick delete: how many order rows carry each of their SOs — every row, removed and
  //    cancelled included (see pickDeleteTouched). idx_orders_sonumber.
  let soRowCounts = new Map<string, number>();
  if (arms.pickDelete) {
    const sos = Array.from(new Set(facts.map((f) => f.soNumber).filter((s): s is string => s !== null && s.trim() !== "")));
    if (sos.length > 0) {
      const grouped = await prisma.orders.groupBy({ by: ["soNumber"], where: { soNumber: { in: sos } }, _count: { _all: true } });
      soRowCounts = new Map(grouped.map((g) => [g.soNumber as string, g._count._all]));
    }
  }

  // 3. Telephonic: which changed orders a tag has matched (so_tag_matches_orderId_idx).
  const matched =
    arms.telephonic && orderIds.length > 0
      ? (await prisma.so_tag_matches.findMany({ where: { orderId: { in: orderIds } }, select: { orderId: true }, take: 1 })).map(
          (m) => m.orderId,
        )
      : [];

  // 4. Print: changed trips that are on the tab now, or ever were (a take-back clears
  //    sentToBillingAt, so the current state alone cannot see a trip LEAVING the tab).
  const printTrips =
    arms.print && tripIds.length > 0
      ? (
          await prisma.trips.findMany({
            where: {
              id: { in: tripIds },
              OR: [
                { sentToBillingAt: { not: null } },
                { activity: { some: { action: { in: [TRIP_SENT_TO_BILLING, TRIP_TAKEN_BACK_FROM_BILLING] } } } },
              ],
            },
            select: { id: true },
            take: 1,
          })
        ).map((t) => t.id)
      : [];

  // 5. Print v2 (2026-10-05): changed ORDERS on a trip that is on the tab now (sent, not
  //    cancelled) — a bill becoming ready, held, or getting a confirmed finding. A bill LEAVING a
  //    trip clears its tripDropId, but the trip's bills_removed activity row arrives as a trip id
  //    and is caught by step 4.
  const printOrders =
    arms.print && orderIds.length > 0
      ? (
          await prisma.orders.findMany({
            where: {
              id: { in: orderIds },
              tripDrop: { trip: { sentToBillingAt: { not: null }, status: { not: "cancelled" } } },
            },
            select: { id: true },
            take: 1,
          })
        ).map((o) => o.id)
      : [];

  const istDay = getISTDayRange();
  return {
    picking: arms.picking && pickingTouched(facts, body.shown.pickingIds, orderIds, istDay),
    print:
      arms.print &&
      printTouched(printTrips, body.shown.printTripIds, tripIds, printOrders, body.shown.printOrderIds, orderIds),
    telephonic: arms.telephonic && telephonicTouched(body.soTagChanged, matched, body.shown.telephonicOrderIds, orderIds),
    pickDelete: arms.pickDelete && pickDeleteTouched(soRowCounts, facts, body.shown.pickDeleteIds, orderIds),
    mailOrders: arms.mailOrders && body.mailOrderIds.length > 0,
  };
}

/** Classify, then count ONLY the touched arms with each marker's own function. */
export async function billingSync(body: SyncBody, arms: SyncArms, now: Date = new Date()): Promise<SyncResult> {
  const touched = await classifyBillingSync(body, arms);
  const counts: SyncResult["counts"] = {};
  if (touched.picking) counts.picking = await countBillingPending();
  if (touched.print) counts.print = await getPrintCount();
  if (touched.telephonic) counts.telephonic = (await getTelephonicMarker(now)).count;
  // Billing's groups only (2026-10-01) — the Tint Manager's never count here.
  if (touched.pickDelete) counts.pickDelete = (await getPickDeleteMarker("billing")).count;
  return { touched, counts };
}
