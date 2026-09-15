import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { setTripSentToBilling } from "@/lib/trips/billing";

export const dynamic = "force-dynamic";

/**
 * POST /api/floor/trips/[id]/billing — Send to billing, or take back (slice 9,
 * 2026-09-15).
 *
 * Body: `{ sent: boolean }`. `true` puts the trip on the Billing screen's Print
 * tab. `false` takes it off again — REFUSED (409) once billing has copied its
 * invoice numbers, because those numbers are already in SAP.
 *
 * 🔴 WRITES THE TRIP, NEVER AN ORDER ROW. `trips.sentToBillingAt` /
 * `sentToBillingById` and one activity row (lib/trips/billing.ts).
 *
 * Idempotent: sending a sent trip, or taking back one that is not sent, is a 200
 * with `changed: false` and nothing written.
 *
 * Gated on `floor` canEdit, like every trip write. Sequential awaits, never
 * prisma.$transaction (CORE §3).
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // The real session user, never a body claim.
  const actorId = Number(session.user.id);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const tripId = Number(params.id);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    return NextResponse.json({ error: "Invalid trip id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { sent?: unknown };
  // A strict boolean, never a truthy test — "false" from a sloppy client would
  // otherwise SEND a trip the caller asked to take back.
  if (typeof body.sent !== "boolean") {
    return NextResponse.json({ error: "sent is required and must be a boolean" }, { status: 400 });
  }

  const outcome = await setTripSentToBilling({ tripId, sent: body.sent, actorId });
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

  return NextResponse.json({
    changed: outcome.changed,
    tripNumber: outcome.tripNumber,
    sentToBillingAt: outcome.sentToBillingAt,
    eligible: outcome.eligible,
    invoiced: outcome.invoiced,
  });
}
