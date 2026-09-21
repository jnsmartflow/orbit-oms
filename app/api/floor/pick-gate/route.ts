import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { isPickGateOn, PICK_VISIBILITY_GATE_KEY } from "@/lib/picking/visibility-gate";

export const dynamic = "force-dynamic";

/**
 * GET / POST /api/floor/pick-gate — read and flip the picking visibility gate
 * ("desk control").
 *
 * The switch is one `app_settings` row keyed by `PICK_VISIBILITY_GATE_KEY`.
 * ON, the supervisor's Assign tab shows a waiting bill ONLY when it is on a trip
 * the desk has SHOWN (`trips.shownAt`, per trip since 2026-09-15; it was a
 * per-bill `orders.pickVisibleAt` stamp before). A bill on no trip ("To plan")
 * is hidden (owner, 2026-09-21). OFF, it shows every waiting bill, which is the
 * board the floor has always had. In-progress and checked bills are never gated.
 *
 * 🔴 BOTH DIRECTIONS WRITE THE SWITCH AND NOTHING ELSE. The switch and
 * `trips.shownAt` are independent: turning it ON marks no trip shown, and turning
 * it OFF clears no trip's record. Trips the planner showed stay shown, trips he
 * did not stay hidden, and the To plan pool is hidden — so an OFF → ON press CAN
 * take bills off the supervisor's screen at once. That is the owner's intent: the
 * planner's show choices stand. An off press that erased them would silently
 * undo an afternoon's work, and an on press that overrode them would do the same.
 *
 * Until 2026-09-21 turning the gate ON first marked every unshown trip holding a
 * waiting bill as shown (the no-cliff rule). Removed by owner: the planner's show
 * choices stand. Do not revert.
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

  // The switch only — no trip is shown or taken back by a flip (see the header).
  // Upsert on the settingKey unique constraint (app_settings_settingKey_key,
  // live — so this is safe). First flip creates the row, every later one updates
  // it. `updatedAt` is @updatedAt in the schema and stamps itself on both paths.
  // Sequential await, never prisma.$transaction (CORE §3).
  await prisma.app_settings.upsert({
    where: { settingKey: PICK_VISIBILITY_GATE_KEY },
    update: { isEnabled: enabled, updatedById },
    create: { settingKey: PICK_VISIBILITY_GATE_KEY, isEnabled: enabled, updatedById },
  });

  return NextResponse.json({ enabled });
}
