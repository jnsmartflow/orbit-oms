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

// ─────────────────────────────────────────────────────────────────────────────
// THE STAMPER — extracted 2026-09-09 from app/api/floor/pick-visible/route.ts
// so the trip module's Release can hand bills over by the SAME rule instead of
// a second copy of it.
//
// 🔴 ONE OWNER PER BEHAVIOUR. Two callers now stamp `orders.pickVisibleAt`:
//   - app/api/floor/pick-visible/route.ts  (the operator's Show / Send back)
//   - app/api/trips/[id]/release/route.ts  (releasing a whole trip)
// A second implementation would be two answers to "may this bill be handed
// over", on the same column, on the same screen. The route that used to own
// this now calls it and does nothing else with the columns.
//
// EVERY GUARD BELOW IS THE ORIGINAL, MOVED VERBATIM. Nothing was relaxed to
// make the trip caller's life easier — if a trip holds a bill that may not be
// stamped, the honest answer is that it is skipped, and the trip release route
// reports that rather than working around it.
// ─────────────────────────────────────────────────────────────────────────────

export interface PickVisibilityFailure {
  orderId: number;
  error: string;
}

export interface PickVisibilityResult {
  /** Bills whose stamp actually moved. */
  changed: number[];
  /** Bills already in the requested state — a success, and NO write happened. */
  skipped: number[];
  /** Bills that could not be stamped, each with the reason. */
  failed: PickVisibilityFailure[];
}

/**
 * Stamp or clear `orders.pickVisibleAt` / `pickVisibleById` for a set of bills.
 *
 * `visible: true` hands the bills to the picking floor; `false` pulls them back
 * to the desk. Returns three honest buckets — nothing is swallowed and a skip
 * is never reported as a write.
 *
 * ═══ 🔒 THE SERVER REFUSAL. THIS IS THE COPY THAT LASTS ═══
 *
 * Owner ruling: a bill that is with a picker, or already picked, or checked, can
 * NEVER be marked visible — there is nothing to hand over, the handover already
 * happened. Three layers enforce it: the button (which does not offer it), the
 * query (which never gates those stages), and THIS. The other two are UI and can
 * be changed by anyone in an afternoon; a direct POST bypasses both and lands
 * here. Do not remove this check as redundant — it is the only one that holds
 * when the other two are wrong.
 *
 * 🔒 AND IT APPLIES IN BOTH DIRECTIONS, WHICH IS WHAT MAKES PULL-BACK SAFE.
 * The dangerous case is a race, not a mistake: the operator ticks a bill to send
 * it back at the same moment a supervisor assigns it. By the time the request
 * lands the bill is `pick_assigned` — a picker is walking to the rack — and the
 * stage guard refuses it with a message naming the stage, instead of quietly
 * yanking the work out of his hands and leaving him holding a bill no screen
 * shows.
 *
 * ⚠ NO `order_status_logs` ROW IS WRITTEN, and that is deliberate.
 *   - The order already carries the whole record: `pickVisibleById` is who,
 *     `pickVisibleAt` is when. A log row would be a second copy of two columns.
 *   - Unlike hide (ORDER_HIDDEN) or early release (PICK_EARLY_RELEASED), this is
 *     a routine, high-frequency action — an operator works through a selection
 *     several times a day, and a trip release stamps a whole load at once. At
 *     100+ bills a day the log would bury the events somebody actually reads.
 *   - It would also be a SECOND write per bill. The live-sync markers key on
 *     `MAX(orders.updatedAt)`, so every extra write on a picking path fires a
 *     false "changed" on every board (FLOOR §4 / PICKING §10). One write per
 *     bill is the contract, and this function keeps it.
 *
 * Sequential awaits only, never prisma.$transaction (CORE §3).
 */
export async function stampPickVisibility(opts: {
  orderIds: number[];
  visible: boolean;
  /** The real session user. Never a body claim. */
  actorId: number;
}): Promise<PickVisibilityResult> {
  const { orderIds, visible, actorId } = opts;

  const changed: number[] = [];
  const skipped: number[] = [];
  const failed: PickVisibilityFailure[] = [];

  for (const orderId of orderIds) {
    try {
      const order = await prisma.orders.findUnique({
        where: { id: orderId },
        select: { id: true, workflowStage: true, isRemoved: true, pickVisibleAt: true },
      });
      if (!order || order.isRemoved) {
        failed.push({ orderId, error: "Order not found" });
        continue;
      }

      // 🔒 THE LOCKED RULE. Only a WAITING bill can be handed over. A
      // pick_assigned / pick_done / pick_checked bill is refused whatever the
      // client sends, and the message names the stage so the refusal is
      // diagnosable rather than mysterious.
      if (order.workflowStage !== SUPPORT_DONE_OUTPUT) {
        failed.push({
          orderId,
          error: visible
            ? `Cannot show a bill at stage ${order.workflowStage} — only waiting bills can be shown.`
            : `Cannot send back a bill at stage ${order.workflowStage} — a picker already has it.`,
        });
        continue;
      }

      // ALREADY IN THE REQUESTED STATE → a SKIP, not a failure, and NO WRITE.
      // The test MIRRORS with the direction: showing skips an already-stamped
      // bill, sending back skips an already-null one.
      //
      // ⚠ AND THE WRITE MUST NOT HAPPEN. A no-op re-write would still bump
      // `orders.updatedAt` and fire a false "changed" on every board's marker
      // (PICKING §10). On the forward path it would also overwrite the original
      // actor and time with whoever fat-fingered the checkbox.
      const alreadyThere = visible ? order.pickVisibleAt !== null : order.pickVisibleAt === null;
      if (alreadyThere) {
        skipped.push(orderId);
        continue;
      }

      // EXACTLY ONE orders.update per bill, in either direction. Both columns
      // land in the same row write, so the change is atomic on its own.
      //
      // The reverse clears BOTH columns. Leaving `pickVisibleById` behind would
      // read as "this bill was released by Ashish" on a bill that is at the desk
      // — a half-cleared record that says something untrue.
      await prisma.orders.update({
        where: { id: orderId },
        data: visible
          ? { pickVisibleAt: new Date(), pickVisibleById: actorId }
          : { pickVisibleAt: null, pickVisibleById: null },
      });

      changed.push(orderId);
    } catch (err) {
      failed.push({ orderId, error: err instanceof Error ? err.message : "Unexpected error" });
    }
  }

  return { changed, skipped, failed };
}
