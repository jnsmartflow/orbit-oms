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
import { matchedInvoiceTargetOf, partTargetOf } from "@/lib/floor/search";
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
    // trip-link.ts is the only writer (v27.66 readers B). Kept on orders, for
    // unsplit bills and OBD / SO numbers; a split OBD named by an invoice
    // number reads that invoice's own row instead (matchedRowOf, below).
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

  // A SPLIT OBD NAMED BY AN INVOICE NUMBER: the matched row's own hold and trip
  // (Split load parts and Add-invoices rows alike). One index-only read for
  // which matched OBDs are split, then ONE read of their matched rows; an
  // unsplit bill (row == OBD) keeps the OBD columns exactly as before.
  // Matched invoice row, not OBD pointer (2026-10-26) — don't revert: 713 of
  // order 18648 rides L-261006-05, orders."tripDropId" (716's) L-261020-05.
  const matchedIds = bills.filter((b) => (invoiceMatches.get(b.id)?.length ?? 0) > 0).map((b) => b.id);
  const splitMatched = new Set(
    matchedIds.length > 0
      ? (
          await prisma.order_invoices.findMany({
            where: { orderId: { in: matchedIds }, seq: { gt: 1 } },
            select: { orderId: true },
            distinct: ["orderId"],
          })
        ).map((r) => r.orderId)
      : [],
  );
  const partRows =
    splitMatched.size > 0
      ? await prisma.order_invoices.findMany({
          where: { id: { in: Array.from(splitMatched).flatMap((id) => invoiceMatches.get(id)!.map((m) => m.id)) } },
          select: {
            id: true,
            isHeld: true,
            tripDrop: { select: { trip: { select: { id: true, tripNumber: true, tripDate: true, status: true } } } },
          },
        })
      : [];
  const partRowById = new Map(partRows.map((r) => [r.id, r]));
  /** The row the number named (the lowest matched seq) — split OBDs only. */
  const matchedRowOf = (orderId: number) =>
    splitMatched.has(orderId) ? partRowById.get(invoiceMatches.get(orderId)![0].id) : undefined;
  const liveTripOf = <T extends { status: string }>(t: T | null | undefined): T | null =>
    t && t.status !== TRIP_CANCELLED ? t : null;

  /** The OBD-level answer — every unsplit hit, and an OBD / SO number. */
  const obdTargetOf = (b: (typeof bills)[number]): FloorSearchTarget => {
    if (b.workflowStage === "cancelled" || (cisByOrder.get(b.id)?.length ?? 0) > 0) return "cancel_ci";
    if (b.dispatchStatus === "hold") return "hold";
    if (b.orderType === "tint" && TINT_ROOM_STAGES.includes(b.workflowStage)) return "tinting";
    if (liveTripOf(b.tripDrop?.trip)) return "trip";
    return "floor";
  };
  const obdTargets = new Map(bills.map((b) => [b.id, obdTargetOf(b)]));
  const targetOf = (b: (typeof bills)[number]): FloorSearchTarget => {
    const m = matchedRowOf(b.id);
    const obd = obdTargets.get(b.id) ?? "floor";
    return m ? matchedInvoiceTargetOf(obd, { isHeld: m.isHeld, onLiveTrip: liveTripOf(m.tripDrop?.trip) !== null }) : obd;
  };
  const targets = new Map(bills.map((b) => [b.id, targetOf(b)]));

  // The Cancel & CI tab's OWN row for each cancel_ci bill, any date — the same
  // builder the tab's feed uses (getFloorCancelled), never a second row shape.
  const cancelIds = ids.filter((id) => targets.get(id) === "cancel_ci");
  const cancelRows: FloorCancelledRow[] =
    cancelIds.length > 0 ? await getFloorCancelled("All", undefined, cancelIds, undefined, undefined, true) : [];
  const cancelRowByOrder = new Map(cancelRows.map((r) => [r.orderId, r]));

  // SPLIT LOAD (Phase 4 batch 4): a number that named TWO OR MORE rows of one
  // OBD — the truck parts of one invoice — gets `parts`, each part's own hold
  // and trip off partRows (read above, with every split OBD's matched rows).

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
    // The matched row's trip on a split OBD — "no trip" when that row is on
    // none, never the derived stop (2026-10-26, don't revert).
    const m = matchedRowOf(b.id);
    const liveTrip = liveTripOf(m ? m.tripDrop?.trip : b.tripDrop?.trip);
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
      // Each part from the OBD-level answer, so one held part never holds the rest.
      ...((invoiceMatches.get(b.id)?.length ?? 0) >= 2 ? { parts: partsOf(b.id, obdTargets.get(b.id) ?? "floor") } : {}),
    };
  });

  return hits;
}
