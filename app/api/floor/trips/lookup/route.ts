import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { parseBillLookupTerm, findBillsByNumber } from "@/lib/trips/find-bill";
import { tripsOnDeskWhere, TRIP_CANCELLED } from "@/lib/trips/live-trips";
import { parseTripDate } from "@/lib/trips/queries";
import { getTodayIST } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * GET /api/floor/trips/lookup?q= — WHICH TRIP IS THIS BILL ON, ANY DAY.
 * (2026-09-29, owner.) READ-ONLY: no write of any kind on this path.
 *
 * The Floor search box works over the rows already loaded for the day in view,
 * so a bill whose trip left the desk days ago is simply not there. The client
 * calls this ONLY when the typed text is one full number AND the loaded desk
 * found nothing (components/floor/floor-page.tsx `commitSearch`).
 *
 * Matches `orders` (isRemoved = false, admin hide rules applied as the board
 * applies them) where the WHOLE number equals the OBD, the SO or the invoice.
 * No suffix matching here: tails are the client's job, over loaded rows only.
 *
 * INVOICES are stored `I` + 9 digits (every live row — lib/ci/queries.ts). So
 * `I536229654`, the bare `536229654`, and the misread `1536229654` (the `I` typed
 * as a `1`) all look up `I536229654` — the same three forms lib/floor/search.ts
 * accepts on the client.
 *
 * Follows orders.tripDropId → trip_drops.tripId → trips. Cancelled trips are
 * skipped (cancel detaches its bills, so one should not appear anyway).
 *
 * `onLiveDesk` — is the trip on TODAY's desk right now? Decided by
 * `tripsOnDeskWhere` (lib/trips/live-trips.ts), the one rule the rail feed uses,
 * so the answer cannot disagree with what the live rail will show. False means
 * the client must go to History on the trip's own date.
 *
 * Indexes (pg_indexes, read 2026-09-29): orders_obdNumber_key,
 * orders_invoiceNo_idx and idx_orders_sonumber — all three columns are indexed.
 *
 * Gate: floor canView, the same as the board. Sequential awaits (CORE §3).
 */
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canView");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Whole numbers only — the same test the client's lookupTermOf applies. The
  // matching rule lives in lib/trips/find-bill.ts (shared with the re-delivery
  // search); this route keeps the trip-following part.
  const term = parseBillLookupTerm(new URL(req.url).searchParams.get("q") ?? "");
  if (term === null) {
    return NextResponse.json({ error: "q must be one full OBD, SO or invoice number" }, { status: 400 });
  }
  const q = term.q;

  const orders = await findBillsByNumber(
    term,
    {
      obdNumber: true,
      tripDrop: {
        select: { trip: { select: { id: true, tripNumber: true, tripDate: true, status: true } } },
      },
    },
    { onTripOnly: true },
  );

  // One entry per trip, its matched OBDs listed.
  const byTrip = new Map<
    number,
    { tripId: number; tripNumber: string; tripDate: string; status: string; obdNumbers: string[] }
  >();
  for (const o of orders) {
    const t = o.tripDrop?.trip;
    if (!t || t.status === TRIP_CANCELLED) continue;
    const entry = byTrip.get(t.id) ?? {
      tripId: t.id,
      tripNumber: t.tripNumber,
      tripDate: t.tripDate.toISOString().slice(0, 10),
      status: t.status,
      obdNumbers: [],
    };
    entry.obdNumbers.push(o.obdNumber);
    byTrip.set(t.id, entry);
  }

  const today = parseTripDate(getTodayIST());
  const trips: Array<{
    tripId: number;
    tripNumber: string;
    tripDate: string;
    status: string;
    obdNumber: string;
    obdNumbers: string[];
    onLiveDesk: boolean;
  }> = [];
  for (const entry of Array.from(byTrip.values())) {
    const onDesk = await prisma.trips.count({
      where: { AND: [{ id: entry.tripId }, tripsOnDeskWhere(today, today)] },
    });
    trips.push({ ...entry, obdNumber: entry.obdNumbers[0], onLiveDesk: onDesk > 0 });
  }
  // Newest trip first — the likeliest one the planner means.
  trips.sort((a, b) => (a.tripDate === b.tripDate ? b.tripId - a.tripId : a.tripDate < b.tripDate ? 1 : -1));

  return NextResponse.json({ q, trips });
}
