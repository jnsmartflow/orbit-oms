// lib/floor/search-hits.ts — THE HITS OF GET /api/floor/search (moved out of
// app/api/floor/search/route.ts unchanged, 2026-10-26, so a read-only parity
// script can call it without a session; the route keeps the auth gate). See
// the route's header for the target precedence. READ-ONLY. Sequential awaits,
// never prisma.$transaction (CORE §3).

import { prisma } from "@/lib/prisma";
import { findBillsByNumber, invoiceRowMatches, type BillLookupTerm } from "@/lib/trips/find-bill";
import { tripsOnDeskWhere, TRIP_CANCELLED } from "@/lib/trips/live-trips";
import { parseTripDate } from "@/lib/trips/queries";
import { getFloorCancelled } from "@/lib/floor/queries";
import { deskShipToName } from "@/lib/ship-to/effective";
import { getTodayIST } from "@/lib/dates";
import type { FloorCancelledRow, FloorSearchHit, FloorSearchPart, FloorSearchTarget } from "@/lib/floor/types";
import { partTargetOf } from "@/lib/floor/search";
import { loadGroupsOf } from "@/lib/order-invoices/load-plan";

/** The Tinting tab's stages — a tint bill not yet on the mixer (isTintRoomRow,
 *  components/floor/status-pill.tsx). On the mixer it is a Floor row. */
const TINT_ROOM_STAGES = ["pending_tint_assignment", "tint_assigned"];

/** Every bill one full number names, as the Floor search box jumps to it. */
export async function getFloorSearchHits(term: BillLookupTerm): Promise<FloorSearchHit[]> {
  // Any invoice of the OBD, typed ones included (Add invoices Phase 4) — read
  // once here so each hit can say WHICH invoice the number named.
  const invoiceMatches = await invoiceRowMatches(term);

  // No `onTripOnly` — every bill the number names, on a trip or not.
  const bills = await findBillsByNumber(term, {
    id: true,
    obdNumber: true,
    invoiceNo: true,
    soNumber: true,
    orderType: true,
    workflowStage: true,
    dispatchStatus: true,
    shipToCustomerName: true,
    // A typed ship-to (v27.73, step 7A) names the hit like the board row does.
    shipToText: true,
    customer: { select: { customerName: true } },
    shipToOverrideCustomer: { select: { customerName: true } },
    // "Which trip is this bill on" — the DERIVED stop (lowest-seq invoice row),
    // which orders."tripDropId" holds exactly while lib/order-invoices/
    // trip-link.ts is the only writer (v27.66 readers B). Kept on orders.
    tripDrop: {
      select: { trip: { select: { id: true, tripNumber: true, tripDate: true, status: true } } },
    },
  }, { invoiceMatches });
  if (bills.length === 0) return [];

  const ids = bills.map((b) => b.id);

  // Live CIs — the same test every CI surface uses (status <> 'draft', not voided).
  const cis = await prisma.ci_returns.findMany({
    where: { orderId: { in: ids }, isVoided: false, status: { not: "draft" } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, orderId: true, ciNumber: true, status: true, orderInvoiceId: true },
  });
  // 6.3 — a CI on ONE invoice of a SPLIT OBD does not move the OBD to Cancel &
  // CI: its other invoices are still on the floor. Only a CI covering the bill
  // (unsplit, or orderInvoiceId NULL) does. One index-only read, skipped when no
  // hit has a CI with a row key.
  const keyed = Array.from(new Set(cis.filter((c) => c.orderInvoiceId !== null).map((c) => c.orderId)));
  const splitIds = new Set(
    keyed.length > 0
      ? (
          await prisma.order_invoices.findMany({
            where: { orderId: { in: keyed }, seq: { gt: 1 } },
            select: { orderId: true },
            distinct: ["orderId"],
          })
        ).map((r) => r.orderId)
      : [],
  );
  const cisByOrder = new Map<number, Array<{ id: number; ciNumber: string | null; status: string }>>();
  for (const c of cis) {
    if (c.orderInvoiceId !== null && splitIds.has(c.orderId)) continue;
    const list = cisByOrder.get(c.orderId) ?? [];
    list.push({ id: c.id, ciNumber: c.ciNumber, status: c.status });
    cisByOrder.set(c.orderId, list);
  }

  const targetOf = (b: (typeof bills)[number]): FloorSearchTarget => {
    if (b.workflowStage === "cancelled" || (cisByOrder.get(b.id)?.length ?? 0) > 0) return "cancel_ci";
    if (b.dispatchStatus === "hold") return "hold";
    if (b.orderType === "tint" && TINT_ROOM_STAGES.includes(b.workflowStage)) return "tinting";
    const t = b.tripDrop?.trip;
    if (t && t.status !== TRIP_CANCELLED) return "trip";
    return "floor";
  };
  const targets = new Map(bills.map((b) => [b.id, targetOf(b)]));

  // The Cancel & CI tab's OWN row for each cancel_ci bill, any date — the same
  // builder the tab's feed uses (getFloorCancelled), never a second row shape.
  const cancelIds = ids.filter((id) => targets.get(id) === "cancel_ci");
  const cancelRows: FloorCancelledRow[] =
    cancelIds.length > 0 ? await getFloorCancelled("All", undefined, cancelIds, undefined, undefined, true) : [];
  const cancelRowByOrder = new Map(cancelRows.map((r) => [r.orderId, r]));

  // SPLIT LOAD (Phase 4 batch 4): a number that named TWO OR MORE rows of one
  // OBD — the truck parts of one invoice. Each part's own hold and trip, ONE
  // read, and only then; every other hit reads exactly what it did before.
  const multi = bills.filter((b) => (invoiceMatches.get(b.id)?.length ?? 0) >= 2);
  const partRows =
    multi.length > 0
      ? await prisma.order_invoices.findMany({
          where: { id: { in: multi.flatMap((b) => invoiceMatches.get(b.id)!.map((m) => m.id)) } },
          select: {
            id: true,
            isHeld: true,
            tripDrop: { select: { trip: { select: { id: true, tripNumber: true, tripDate: true, status: true } } } },
          },
        })
      : [];
  const partRowById = new Map(partRows.map((r) => [r.id, r]));

  // On TODAY's desk? — tripsOnDeskWhere, the rail's own rule (as the lookup
  // decides it). One count per distinct trip, sequential.
  const today = parseTripDate(getTodayIST());
  const onDeskByTrip = new Map<number, boolean>();
  for (const t of [...bills.map((b) => b.tripDrop?.trip), ...partRows.map((r) => r.tripDrop?.trip)]) {
    if (!t || t.status === TRIP_CANCELLED || onDeskByTrip.has(t.id)) continue;
    const n = await prisma.trips.count({ where: { AND: [{ id: t.id }, tripsOnDeskWhere(today, today)] } });
    onDeskByTrip.set(t.id, n > 0);
  }
  const tripOut = (t: { id: number; tripNumber: string; tripDate: Date; status: string } | null | undefined): FloorSearchHit["trip"] =>
    t && t.status !== TRIP_CANCELLED
      ? {
          id: t.id,
          number: t.tripNumber,
          date: t.tripDate.toISOString().slice(0, 10),
          status: t.status,
          onLiveDesk: onDeskByTrip.get(t.id) ?? false,
        }
      : null;
  /** Each matched part, its place by loadGroupsOf (the one home of "part k of n"). */
  const partsOf = (orderId: number, obdTarget: FloorSearchTarget): FloorSearchPart[] => {
    const matches = invoiceMatches.get(orderId) ?? [];
    const groups = loadGroupsOf(matches);
    return matches.map((m) => {
      const row = partRowById.get(m.id);
      const trip = tripOut(row?.tripDrop?.trip);
      const place = groups.get(m.id)!;
      return {
        id: m.id,
        seq: m.seq,
        k: place.k,
        n: place.n,
        invoiceNo: m.invoiceNo,
        target: partTargetOf(obdTarget, { isHeld: row?.isHeld ?? false, onLiveTrip: trip !== null }),
        trip,
      };
    });
  };

  const hits: FloorSearchHit[] = bills.map((b) => {
    const t = b.tripDrop?.trip;
    const liveTrip = t && t.status !== TRIP_CANCELLED ? t : null;
    const target = targets.get(b.id) ?? "floor";
    return {
      orderId: b.id,
      obdNumber: b.obdNumber,
      invoiceNo: b.invoiceNo,
      matchedInvoiceSeq: invoiceMatches.get(b.id)?.[0]?.seq ?? null,
      soNumber: b.soNumber,
      dealer: deskShipToName(b, {
        effectiveDealer: b.shipToOverrideCustomer?.customerName ?? b.customer?.customerName,
        sap: b.shipToCustomerName,
      }),
      workflowStage: b.workflowStage,
      dispatchStatus: b.dispatchStatus,
      target,
      trip: liveTrip
        ? {
            id: liveTrip.id,
            number: liveTrip.tripNumber,
            date: liveTrip.tripDate.toISOString().slice(0, 10),
            status: liveTrip.status,
            onLiveDesk: onDeskByTrip.get(liveTrip.id) ?? false,
          }
        : null,
      cis: cisByOrder.get(b.id) ?? [],
      cancelRow: target === "cancel_ci" ? cancelRowByOrder.get(b.id) ?? null : null,
      // Only when the number named 2+ rows — every other hit keeps its exact keys.
      ...((invoiceMatches.get(b.id)?.length ?? 0) >= 2 ? { parts: partsOf(b.id, target) } : {}),
    };
  });

  return hits;
}
