// lib/order-invoices/trip-refusal.ts — "THIS BILL IS ON A TRIP" IN WORDS, BUILT
// FROM THE INVOICE ROWS (Add invoices, Phase 5 commit 2, 2026-10-15).
// PURE — no Prisma client, no clock, no React — because lib/floor/off-floor.ts
// and lib/billing/refusal.ts import it and both are read by client components
// (a button and the route that serves it must never disagree). The Prisma
// import below is TYPES ONLY.
// Tests: lib/order-invoices/trip-refusal.test.ts.
//
// From Phase 5 one invoice of a split OBD can sit on a trip while the others do
// not. Cancel / CI / ship-to / Hand are still per OBD, so ANY invoice on a trip
// still refuses them — but the message says how many and where:
//   all on one trip            → "On trip L-02 — remove it from the trip first"
//                                (today's wording, unchanged)
//   some on one trip           → "2 of 4 invoices on L-02 — remove them from the trip first"
//   on two trips               → "1 of 4 invoices on L-02, 1 on L-05 — remove them from the trips first"
// An UNSPLIT OBD (or a caller that passes no rows) gets today's sentence from
// the OBD's own tripDropId / tripNumber, byte for byte.

import type { Prisma } from "@prisma/client";

/** One invoice row's place, as the message needs it. */
export interface InvoiceTrip {
  tripDropId: number | null;
  tripNumber: string | null;
}

/**
 * The `invoices` select every refusing route adds beside its tripDropId /
 * tripDrop read — seq order, each row's stop and that stop's trip number.
 */
export const INVOICE_TRIPS_SELECT = {
  orderBy: { seq: "asc" },
  select: { tripDropId: true, tripDrop: { select: { trip: { select: { tripNumber: true } } } } },
} satisfies Prisma.orders$invoicesArgs;

/** The select's rows → InvoiceTrip[]. */
export function invoiceTripsOf(
  rows: ReadonlyArray<{ tripDropId: number | null; tripDrop: { trip: { tripNumber: string } } | null }>,
): InvoiceTrip[] {
  return rows.map((r) => ({ tripDropId: r.tripDropId, tripNumber: r.tripDrop?.trip.tripNumber ?? null }));
}

/** What the rule needs: the OBD's own pointer, and (optionally) its rows. */
export interface OnTripBill {
  tripDropId?: number | null;
  tripNumber?: string | null;
  /** The OBD's invoice rows. Two or more = split: the message is built from them. */
  invoiceTrips?: readonly InvoiceTrip[];
}

/** The refusal text when any invoice of the bill is on a trip, else null. */
export function onTripMessage(bill: OnTripBill): string | null {
  const rows = bill.invoiceTrips;
  if (rows !== undefined && rows.length >= 2) {
    const on = rows.filter((r) => r.tripDropId !== null);
    if (on.length === 0) return null;
    const byTrip = new Map<string, number>();
    for (const r of on) {
      const n = r.tripNumber ?? "(unknown)";
      byTrip.set(n, (byTrip.get(n) ?? 0) + 1);
    }
    const trips = Array.from(byTrip.entries());
    if (on.length === rows.length && trips.length === 1) {
      return `On trip ${trips[0][0]} — remove it from the trip first`;
    }
    const where = trips
      .map(([n, k], i) => (i === 0 ? `${k} of ${rows.length} invoices on ${n}` : `${k} on ${n}`))
      .join(", ");
    return `${where} — remove ${on.length === 1 ? "it" : "them"} from the trip${trips.length === 1 ? "" : "s"} first`;
  }
  if (bill.tripDropId === null || bill.tripDropId === undefined) return null;
  return `On trip ${bill.tripNumber ?? "(unknown)"} — remove it from the trip first`;
}
