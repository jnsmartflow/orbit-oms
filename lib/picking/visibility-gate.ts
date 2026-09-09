import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SUPPORT_DONE_OUTPUT } from "@/lib/workflow-stages";

// ─────────────────────────────────────────────────────────────────────────────
// The floor visibility gate — read-only helper.
//
// One row in `app_settings` decides whether the supervisor's Assign tab shows
// every waiting bill (the board as it has always been) or only the bills an
// operator has explicitly made visible (`orders.pickVisibleAt`).
//
// ⚠ DEFAULT-OFF, the OPPOSITE of lib/hide/tag-settings.ts, and the asymmetry is
// deliberate. A tag defaults ON because a missing row must not make a badge
// disappear. This defaults OFF because a missing row must not make the floor's
// WORK disappear: with the gate on and nothing marked visible, the Assign tab is
// empty and three supervisors are standing at a screen that shows no bills. The
// safe direction is always "show the supervisor his work", so every uncertain
// answer here resolves to false.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The one `app_settings.settingKey` this module owns.
 *
 * Exported so no caller ever retypes the string. A hand-typed key in a `where`
 * matches nothing and fails SILENTLY — the gate would read as permanently off
 * and nobody would see an error (CORE §3, the status-string rule; same class).
 */
export const PICK_VISIBILITY_GATE_KEY = "picking.visibilityGate";

/**
 * Is the floor visibility gate switched ON?
 *
 * FAILS CLOSED TO FALSE, in all four ways it can fail:
 *   - no row for the key      → false (the ship state; nothing has been enabled)
 *   - row with isEnabled false → false
 *   - a null/undefined read    → false (the `=== true` test, not a truthy one)
 *   - the query itself throws  → false (caught below)
 *
 * The throw case matters: this runs on the marker's 15s poll and on every queue
 * fetch. A database blip must degrade to the ungated board the floor already
 * knows, never to an empty screen. Sequential await, no prisma.$transaction
 * (CORE §3).
 */
export async function isPickGateOn(): Promise<boolean> {
  try {
    const row = await prisma.app_settings.findUnique({
      where: { settingKey: PICK_VISIBILITY_GATE_KEY },
      select: { isEnabled: true },
    });
    return row?.isEnabled === true;
  } catch {
    return false;
  }
}

/**
 * How many WAITING bills the gate is currently hiding from the picking board.
 *
 * 🔴 THE ONE OWNER OF THIS COUNT. Both picking surfaces show the number — the
 * supervisor's Assign-tab band gets it on first paint from the queue payload
 * (`getPickingQueue`), and the 15s marker gets it from
 * `app/api/picking/marker/route.ts` — and two hand-written copies of a count is
 * two numbers that drift, on the same screen, in the same shift. Neither caller
 * writes these terms itself.
 *
 * ⚠ `boardWhere` MUST BE THE UNGATED PREDICATE — `buildPickingWhere(...)` with
 * `gateOn` omitted or false. A gated where already excludes every row this
 * function is trying to count, so passing one returns 0. That is a wrong number
 * but the SAFE wrong number: the band simply does not render, which is the
 * screen as it was before the band existed, rather than a figure that overstates
 * what is at the desk.
 *
 * The parameter exists rather than the options, deliberately: building the where
 * here would mean importing `buildPickingWhere` from lib/picking/queue.ts, which
 * already imports `isPickGateOn` from this file. That cycle resolves at runtime
 * but is exactly the kind of thing nobody should have to reason about to read a
 * count.
 *
 * WHY THE TOP-LEVEL `workflowStage` IS ENOUGH: Prisma ANDs top-level keys onto
 * the board predicate's `OR`, and `SUPPORT_DONE_OUTPUT` contradicts both the
 * in-progress branch and the checked branch — so only the waiting branch can
 * match, and no clock-fenced branch can influence the answer.
 *
 * Gate OFF → 0 with NO QUERY. Nothing is held back when the filter is not
 * running, so a poll costs exactly what it cost before the gate existed.
 *
 * Sequential await, never prisma.$transaction. SELECT only — no `orders.update`
 * anywhere near this, or the marker would see a false "changed" (CORE §3).
 */
export async function countHeldBackWaiting(
  boardWhere: Prisma.ordersWhereInput,
  gateOn: boolean,
): Promise<number> {
  if (!gateOn) return 0;
  return prisma.orders.count({
    where: {
      ...boardWhere,
      workflowStage: SUPPORT_DONE_OUTPUT,
      pickVisibleAt: null,
    },
  });
}
