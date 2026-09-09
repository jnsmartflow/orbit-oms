import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { isPickGateOn, PICK_VISIBILITY_GATE_KEY } from "@/lib/picking/visibility-gate";

export const dynamic = "force-dynamic";

/**
 * GET / POST /api/floor/pick-gate — read and flip the picking visibility gate.
 *
 * The switch is one `app_settings` row keyed by `PICK_VISIBILITY_GATE_KEY`.
 * ON, the supervisor's Assign tab shows only bills an operator has handed over
 * (`orders.pickVisibleAt`, stamped by `/api/floor/pick-visible`). OFF, it shows
 * every waiting bill, which is the board the floor has always had and the state
 * this ships in.
 *
 * 🔴 THE SWITCH AND THE STAMPS ARE COMPLETELY INDEPENDENT, and nothing here may
 * ever couple them. Turning the gate ON writes no `pickVisibleAt`. Turning it
 * OFF clears none. The switch decides whether the FILTER RUNS; the stamps record
 * WHAT WAS HANDED OVER, and they outlive any number of toggles.
 *
 * The failure this prevents is not hypothetical. If turning the gate off cleared
 * the stamps, an operator who flipped it off to unblock a busy hour would lose
 * every handover he made that afternoon, silently, and turning it back on would
 * empty the floor's board. Clearing a stamp is a per-BILL decision that belongs
 * to a per-bill route, not to a switch.
 *
 * BOTH VERBS GATE ON `floor` canEdit — admin and operations, exactly who holds
 * the floor page key. `floor_supervisor` must NOT be able to flip it: he is the
 * person the gate is applied TO, and a switch its own subject can turn off is
 * not a control. The read is gated the same way deliberately — the answer is an
 * operations setting, not board data, and the supervisor's board already reflects
 * it without having to ask.
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

  // Upsert on the settingKey unique constraint (app_settings_settingKey_key,
  // live — so this is safe). First flip creates the row, every later one updates
  // it. `updatedAt` is @updatedAt in the schema and stamps itself on both paths.
  //
  // ⚠ THIS TOUCHES `app_settings` AND NOTHING ELSE. No orders.update, no
  // pickVisibleAt written or cleared — see the header. Sequential await, never
  // prisma.$transaction (CORE §3).
  await prisma.app_settings.upsert({
    where: { settingKey: PICK_VISIBILITY_GATE_KEY },
    update: { isEnabled: enabled, updatedById },
    create: { settingKey: PICK_VISIBILITY_GATE_KEY, isEnabled: enabled, updatedById },
  });

  return NextResponse.json({ enabled });
}
