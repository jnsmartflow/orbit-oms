import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { isPickGateOn } from "@/lib/picking/visibility-gate";
import { setTripShown } from "@/lib/trips/show";

export const dynamic = "force-dynamic";

/**
 * POST /api/floor/trips/[id]/show — Show to floor, or take back (slice 8,
 * 2026-09-15).
 *
 * Body: `{ shown: boolean }`. `true` shows the trip: with desk control on, its
 * WAITING bills reach the supervisor's Assign tab. `false` takes it back: its
 * still-waiting bills leave the Assign tab again, and anything already with a
 * picker stays exactly where it is (never gated — lib/picking/queue.ts).
 *
 * 🔴 WRITES THE TRIP, NEVER AN ORDER ROW. `trips.shownAt` / `shownById` and one
 * activity row. No trip action may change a bill's status or its hold — and the
 * live-sync markers key on MAX(orders.updatedAt), so an order write here would
 * also fire a false "changed" on every board. The picking query reads the trip
 * instead (lib/picking/visibility-gate.ts waitingBranchWhere).
 *
 * ⚠ REFUSED WHILE DESK CONTROL IS OFF, BOTH DIRECTIONS (409). With the switch off
 * every waiting bill is already visible, so a show or a take-back would change
 * nothing on anybody's screen. The button is greyed with "Desk control is off"
 * for the same reason; this is the server's half. (Until 2026-09-21 a take-back
 * made while off would also have been undone by the no-cliff rule on the next
 * OFF → ON flip; that rule is gone.)
 *
 * Idempotent: showing a shown trip, or taking back one that is not shown, is a
 * 200 with `changed: false` and nothing written.
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

  const body = (await req.json().catch(() => ({}))) as { shown?: unknown };
  // A strict boolean, never a truthy test — "false" from a sloppy client would
  // otherwise SHOW a trip the caller asked to take back.
  if (typeof body.shown !== "boolean") {
    return NextResponse.json({ error: "shown is required and must be a boolean" }, { status: 400 });
  }

  if (!(await isPickGateOn())) {
    return NextResponse.json(
      { error: "Desk control is off — every waiting bill is already visible to the floor." },
      { status: 409 },
    );
  }

  const outcome = await setTripShown({ tripId, shown: body.shown, actorId });
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

  return NextResponse.json({
    changed: outcome.changed,
    tripNumber: outcome.tripNumber,
    shownAt: outcome.shownAt,
    waitingCount: outcome.waitingCount,
  });
}
