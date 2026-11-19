import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { loadBillingOrderDetail } from "@/lib/billing/order-detail";
import { isBillOnSentTrip, loadPrintTrips } from "@/lib/billing/print";

export const dynamic = "force-dynamic";

/**
 * GET /api/billing/print/order/[orderId]?tripId=[&dropSeq=] — one bill for the
 * Print tab's detail panel (Billing Print v2, 2026-10-05).
 *
 * `dropSeq` (per-part ship-to, v27.81): one bill may be a Print LINE at two
 * stops of the trip (its parts go to two shops); the line's stop number picks
 * THAT line — its shop, invoices and copy state. Omitted, or no line at that
 * stop (the stops closed up since the list was read), → the bill's first line,
 * exactly as before. dropSeq rather than the stop id because PrintBillRow
 * carries dropSeq; it is unique within a trip.
 *
 * Answer: `{ detail, bill, trip }`
 *   detail — the bill, its active lines and its CONFIRMED pick findings, from
 *            lib/billing/order-detail.ts (the same read the Picking tab's panel
 *            uses, so the two panels describe one bill identically);
 *   bill   — this bill's Print row (lib/billing/print.ts PrintBillRow): its
 *            state (copied / ready / review / waiting / held), Floor's
 *            StatusPill inputs, the copy on this trip and the note for a copy
 *            on another trip;
 *   trip   — the few trip facts the panel shows.
 *
 * 🔒 FENCED, unlike the Picking route: the bill must be on `tripId`, and that
 * trip must be on the Print tab (sent to billing, not cancelled) — else 404.
 * The Print tab only ever opens a bill from a trip it is showing, and a
 * `billing_print` holder has no business reading an arbitrary bill here.
 *
 * READ-ONLY. Gated on `billing_print` canView — NOT billing_picking.
 * Sequential awaits (CORE §3).
 */
export async function GET(
  req: Request,
  { params }: { params: { orderId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "billing_print", "canView");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const orderId = Number(params.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
  }
  const search = new URL(req.url).searchParams;
  const tripId = Number(search.get("tripId"));
  if (!Number.isInteger(tripId) || tripId <= 0) {
    return NextResponse.json({ error: "tripId is required" }, { status: 400 });
  }

  if (!(await isBillOnSentTrip(orderId, tripId))) {
    return NextResponse.json({ error: "This bill is not on that trip, or the trip is not on Print" }, { status: 404 });
  }

  const detail = await loadBillingOrderDetail(orderId);
  if (!detail) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const [trip] = await loadPrintTrips([tripId]);
  const dropSeqParam = search.get("dropSeq");
  const dropSeq = dropSeqParam !== null ? Number(dropSeqParam) : null;
  if (dropSeq !== null && (!Number.isInteger(dropSeq) || dropSeq <= 0)) {
    return NextResponse.json({ error: "Invalid dropSeq" }, { status: 400 });
  }
  const bill =
    (dropSeq !== null ? trip?.rows.find((r) => r.orderId === orderId && r.dropSeq === dropSeq) : undefined) ??
    trip?.rows.find((r) => r.orderId === orderId) ??
    null;
  if (!trip || !bill) {
    return NextResponse.json({ error: "This bill is not on that trip, or the trip is not on Print" }, { status: 404 });
  }

  return NextResponse.json(
    {
      detail,
      bill,
      trip: {
        id: trip.id,
        tripNumber: trip.tripNumber,
        state: trip.state,
        billingDoneAt: trip.billingDoneAt,
      },
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
