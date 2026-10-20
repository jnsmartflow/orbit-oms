import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { parseBillLookupTerm, findBillsByNumber, invoiceRowMatches } from "@/lib/trips/find-bill";
import { tripsOnDeskWhere, TRIP_CANCELLED } from "@/lib/trips/live-trips";
import { parseTripDate } from "@/lib/trips/queries";
import { getFloorCancelled } from "@/lib/floor/queries";
import { deskShipToName } from "@/lib/ship-to/effective";
import { getTodayIST } from "@/lib/dates";
import type { FloorCancelledRow, FloorSearchHit, FloorSearchTarget } from "@/lib/floor/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/floor/search?q= — WHICH FLOOR TAB IS THIS BILL ON. (2026-10-06, owner.)
 * READ-ONLY: no write of any kind on this path.
 *
 * The Floor search box filters the rows already loaded, and Hold / Cancel & CI
 * may not even be loaded under the live feed. For ONE full number the page asks
 * here, then switches to the bill's tab and highlights its row.
 *
 * 🔴 A NEW ROUTE, NOT A WIDER /api/floor/trips/lookup. That route answers "which
 * TRIP", grouped by trip, bills on trips only — and it is the trip module's.
 * This one answers per BILL, for every tab. Both share ONE matching rule,
 * lib/trips/find-bill.ts: whole-number OBD / SO / invoice, isRemoved = false,
 * admin hide rules applied — so a removed or hidden bill is "no match" here
 * exactly as it is there. No suffix matching, no date limit, at most 50 bills.
 *
 * Target precedence (FloorSearchTarget, lib/floor/types.ts):
 *   cancel_ci > hold > tinting > trip > floor
 * A cancelled bill that was on a trip goes to Cancel & CI.
 *
 * Gate: floor canView, the same as the board and the lookup. Sequential awaits,
 * never prisma.$transaction (CORE §3).
 */

/** The Tinting tab's stages — a tint bill not yet on the mixer (isTintRoomRow,
 *  components/floor/status-pill.tsx). On the mixer it is a Floor row. */
const TINT_ROOM_STAGES = ["pending_tint_assignment", "tint_assigned"];

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canView");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const term = parseBillLookupTerm(new URL(req.url).searchParams.get("q") ?? "");
  if (term === null) {
    return NextResponse.json({ error: "q must be one full OBD, SO or invoice number" }, { status: 400 });
  }

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
  if (bills.length === 0) return NextResponse.json({ q: term.q, hits: [] });

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

  // On TODAY's desk? — tripsOnDeskWhere, the rail's own rule (as the lookup
  // decides it). One count per distinct trip, sequential.
  const today = parseTripDate(getTodayIST());
  const onDeskByTrip = new Map<number, boolean>();
  for (const b of bills) {
    const t = b.tripDrop?.trip;
    if (!t || t.status === TRIP_CANCELLED || onDeskByTrip.has(t.id)) continue;
    const n = await prisma.trips.count({ where: { AND: [{ id: t.id }, tripsOnDeskWhere(today, today)] } });
    onDeskByTrip.set(t.id, n > 0);
  }

  const hits: FloorSearchHit[] = bills.map((b) => {
    const t = b.tripDrop?.trip;
    const liveTrip = t && t.status !== TRIP_CANCELLED ? t : null;
    const target = targets.get(b.id) ?? "floor";
    return {
      orderId: b.id,
      obdNumber: b.obdNumber,
      invoiceNo: b.invoiceNo,
      matchedInvoiceSeq: invoiceMatches.get(b.id)?.seq ?? null,
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
    };
  });

  return NextResponse.json({ q: term.q, hits });
}
