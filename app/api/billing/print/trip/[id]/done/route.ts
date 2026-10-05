import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { markTripBillingDone } from "@/lib/billing/print";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/print/trip/[id]/done — billing pressed "Done — all copied"
 * on the Print tab (Billing Print v2, 2026-10-05). No body.
 *
 * Allowed only when the trip has ≥ 1 non-held bill and every one is copied on
 * this trip (lib/billing/print.ts markTripBillingDone) — else 409. Stamps
 * trips.billingDoneAt / billingDoneById with a conditional update (two presses
 * record once) and writes one `billing_done` activity row. A trip already done
 * answers `changed: false` and writes nothing.
 *
 * 🔴 WRITES THE TRIP, NEVER AN ORDER ROW. Done is manual — nothing stamps it
 * automatically.
 *
 * Gated on `billing_print` canEdit. Sequential awaits (CORE §3).
 */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "billing_print", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const actorId = Number(session.user.id);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const tripId = Number(params.id);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    return NextResponse.json({ error: "Invalid trip id" }, { status: 400 });
  }

  const outcome = await markTripBillingDone({ tripId, actorId });
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

  return NextResponse.json({
    changed: outcome.changed,
    tripNumber: outcome.tripNumber,
    billingDoneAt: outcome.billingDoneAt,
  });
}
