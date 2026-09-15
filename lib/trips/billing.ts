// lib/trips/billing.ts
//
// SEND TO BILLING, PER TRIP (slice 9, 2026-09-15). The one owner of writing
// `trips.sentToBillingAt` / `sentToBillingById`.
//
// The planner's Send to billing puts the trip on the Billing screen's Print tab,
// where billing copies its invoice numbers into SAP (lib/billing/print.ts). The
// take-back lives in the header's ··· menu and is REFUSED once billing has
// copied anything: the numbers are already in SAP, and pulling the trip off the
// tab would hide a record of work that happened (owner).
//
// 🔴 EVERY WRITE HERE IS TO `trips`. Never an order row: no trip action may change
// a bill's status or its hold (the rule the rebuild follows since slice 3).
//
// Sequential awaits, never prisma.$transaction (CORE §3).

import { prisma } from "@/lib/prisma";
import { logTripSentToBilling, logTripTakenBackFromBilling } from "@/lib/trips/activity";
import { loadPrintTrips } from "@/lib/billing/print";

export type SendToBillingOutcome =
  | { ok: true; changed: boolean; tripNumber: string; sentToBillingAt: string | null; eligible: number; invoiced: number }
  | { ok: false; status: number; error: string };

/**
 * Send one trip to billing, or take it back.
 *
 * ⚠ IDEMPOTENT, AND A NO-OP WRITES NOTHING — the same contract as Show to floor
 * (lib/trips/show.ts): a second press never moves the stamp to whoever pressed
 * second, and writes no activity row.
 *
 * ⚠ AN EMPTY TRIP IS REFUSED. With no bills there is nothing for billing to
 * copy, and the card would sit on the Print tab with nothing to do. A trip whose
 * every bill is on hold is NOT refused: holds come off, and billing sees why the
 * trip is waiting.
 *
 * The caller has already checked the permission and the session user.
 */
export async function setTripSentToBilling(opts: {
  tripId: number;
  sent: boolean;
  actorId: number;
}): Promise<SendToBillingOutcome> {
  const trip = await prisma.trips.findUnique({
    where: { id: opts.tripId },
    select: { id: true, tripNumber: true, status: true, sentToBillingAt: true, billingCopiedAt: true },
  });
  if (!trip) return { ok: false, status: 404, error: "Trip not found" };
  if (trip.status === "cancelled" || trip.status === "dispatched") {
    return {
      ok: false,
      status: 409,
      error: `A ${trip.status} trip cannot be ${opts.sent ? "sent to" : "taken back from"} billing.`,
    };
  }

  // The same numbers the Print tab will show — one definition of held and invoiced.
  const [view] = await loadPrintTrips([trip.id]);
  const eligible = view?.eligible ?? 0;
  const invoiced = view?.invoiced ?? 0;

  const alreadyThere = opts.sent ? trip.sentToBillingAt !== null : trip.sentToBillingAt === null;
  if (alreadyThere) {
    return {
      ok: true,
      changed: false,
      tripNumber: trip.tripNumber,
      sentToBillingAt: trip.sentToBillingAt?.toISOString() ?? null,
      eligible,
      invoiced,
    };
  }

  if (opts.sent && (view?.bills ?? 0) === 0) {
    return { ok: false, status: 409, error: `${trip.tripNumber} has no bills to send to billing.` };
  }
  if (!opts.sent && trip.billingCopiedAt !== null) {
    return {
      ok: false,
      status: 409,
      error: `Billing has already copied ${trip.tripNumber}'s invoice numbers — it cannot be taken back.`,
    };
  }

  const updated = await prisma.trips.update({
    where: { id: trip.id },
    data: opts.sent
      ? { sentToBillingAt: new Date(), sentToBillingById: opts.actorId }
      : { sentToBillingAt: null, sentToBillingById: null },
    select: { sentToBillingAt: true },
  });

  if (opts.sent) {
    await logTripSentToBilling({
      tripId: trip.id,
      actorId: opts.actorId,
      tripNumber: trip.tripNumber,
      billCount: eligible,
      invoicedCount: invoiced,
    });
  } else {
    await logTripTakenBackFromBilling({ tripId: trip.id, actorId: opts.actorId, tripNumber: trip.tripNumber });
  }

  return {
    ok: true,
    changed: true,
    tripNumber: trip.tripNumber,
    sentToBillingAt: updated.sentToBillingAt?.toISOString() ?? null,
    eligible,
    invoiced,
  };
}
