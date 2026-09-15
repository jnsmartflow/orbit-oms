import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { isPickGateOn, PICK_VISIBILITY_GATE_KEY } from "@/lib/picking/visibility-gate";
import { showTripsHoldingWaitingBills } from "@/lib/trips/show";

export const dynamic = "force-dynamic";

/**
 * GET / POST /api/floor/pick-gate — read and flip the picking visibility gate
 * ("desk control").
 *
 * The switch is one `app_settings` row keyed by `PICK_VISIBILITY_GATE_KEY`.
 * ON, the supervisor's Assign tab shows a waiting bill only when it is on no
 * trip or on a trip the desk has SHOWN (`trips.shownAt`, slice 8 — per trip
 * since 2026-09-15; it was a per-bill `orders.pickVisibleAt` stamp before). OFF,
 * it shows every waiting bill, which is the board the floor has always had.
 *
 * 🔴 TURNING IT ON WRITES FIRST — THE NO-CLIFF RULE (slice 8, owner, a hard
 * requirement). Turning the switch on must not remove anything already on the
 * supervisor's screen. So an OFF → ON press first marks shown every trip that
 * holds a waiting bill (lib/trips/show.ts showTripsHoldingWaitingBills), THEN
 * flips the switch. Loose bills are always visible and in-progress bills are
 * never gated, so that is the whole set that could have vanished.
 *
 * 🔴 AND AN OFF → ON CYCLE RE-SHOWS A TRIP THE PLANNER HAD HELD BACK. That is
 * DESIGNED, not a bug (owner, 2026-09-15): while the switch was off the
 * supervisor could see that trip's bills anyway, so no-cliff requires showing
 * them again. Nothing is lost — the planner can take the trip back.
 *
 * ⚠ TURNING IT OFF WRITES NOTHING. The filter simply stops, so the supervisor
 * gets everything back, and every trip's shown / not-shown record survives the
 * toggle. (The old rule this replaces — "the switch and the stamps are completely
 * independent" — was right about the off direction and still is: an off press
 * that erased the desk's handovers would silently undo an afternoon's work.)
 *
 * BOTH VERBS GATE ON `floor` canEdit. Since per-user access (2026-09-04) that is
 * ANYONE holding the floor Edit tick, not a pair of job titles — this comment
 * named "admin and operations" until slice 8, and the switch was last flipped on
 * 2026-09-14 by a billing operator holding the tick. `floor_supervisor` must NOT
 * be granted that tick for this reason: he is the person the gate is applied TO,
 * and a switch its own subject can turn off is not a control. The read is gated
 * the same way deliberately — the answer is an operations setting, not board data,
 * and the supervisor's board already reflects it without having to ask.
 */

/** GET → the current state. `{ enabled: boolean }`. */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Read through the SAME helper the queue and the marker use, never a second
  // findUnique here — one reader means the toggle screen can never disagree with
  // the board about which state the switch is in. Absent row → false.
  const enabled = await isPickGateOn();

  return NextResponse.json(
    { enabled },
    // A stale answer would show the operator a switch in the wrong position.
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

/** POST `{ enabled: boolean }` → the new state, `{ enabled: boolean }`. */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const updatedById = Number(session.user.id);
  if (!Number.isInteger(updatedById) || updatedById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { enabled?: boolean };
  // A strict boolean test, not a truthy one. "false" and 0 are exactly the
  // values a sloppy client sends when it means OFF, and coercing either would
  // turn the gate ON for a caller asking to turn it off.
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled is required and must be a boolean" }, { status: 400 });
  }
  const enabled = body.enabled;

  // ── THE NO-CLIFF STEP — only on an OFF → ON press, and BEFORE the flip ──────
  // See the header. The order is the safety: trips first, switch second. If the
  // upsert below then failed, the trips carry a harmless shown record with the
  // switch still off; the reverse order would let the supervisor's 15s poll land
  // between the two writes and drop those bills off his screen.
  //
  // ⚠ TRIPS ONLY — never an order row (no trip action may change a bill).
  let shownTrips: string[] = [];
  if (enabled && !(await isPickGateOn())) {
    shownTrips = await showTripsHoldingWaitingBills(updatedById);
  }

  // Upsert on the settingKey unique constraint (app_settings_settingKey_key,
  // live — so this is safe). First flip creates the row, every later one updates
  // it. `updatedAt` is @updatedAt in the schema and stamps itself on both paths.
  // Sequential await, never prisma.$transaction (CORE §3).
  await prisma.app_settings.upsert({
    where: { settingKey: PICK_VISIBILITY_GATE_KEY },
    update: { isEnabled: enabled, updatedById },
    create: { settingKey: PICK_VISIBILITY_GATE_KEY, isEnabled: enabled, updatedById },
  });

  // `shownTrips` names what the no-cliff step showed, so the desk can say so.
  return NextResponse.json({ enabled, shownTrips });
}
