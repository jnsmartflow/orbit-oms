// lib/dispatch/completion-slot.ts
//
// THE one way a bill gets a slot at the moment it stops being blocked.
//
// 🔴 ONE OWNER PER BEHAVIOUR. Three tint routes finish a bill —
// tint/operator/done, tint/operator/split/done and tint/manager/base-bypass —
// and before 2026-09-11 each carried its own copy of the same `hasPresetSlot`
// branch. They now all call this. A fourth copy of "what slot does a finishing
// bill get" is a fourth answer, and it is always the copy that misses the next
// change.
//
// ⚠ THIS FILE TOUCHES PRISMA, WHICH IS WHY IT IS NOT IN dispatch-engine.ts.
// That file's contract is "pure functions only — no prisma import, no I/O, no
// Date.now()", and it must stay that way: it is the one thing both the importer
// and lib/floor/suggest.ts evaluate, and a backfill has to be able to replay it.
// This is the thin I/O shell around it — read the delivery type, evaluate, map
// the window time to an id.
//
// ⚠ IT RETURNS DATA, IT DOES NOT WRITE. The caller folds the result into its
// OWN single `orders.update`. That is not a style choice: the live-sync markers
// key on MAX(orders.updatedAt), so a second write per bill fires a false
// "changed" on every board in the depot (FLOOR §4/§10, PICKING §10).

import { prisma } from "@/lib/prisma";
import { evaluateDispatchSlot } from "./dispatch-engine";

export interface CompletionSlot {
  dispatchTargetDate: Date;
  dispatchWindowId: number;
  dispatchSlotRuleId: string;
  dispatchSlotSource: "auto";
}

/**
 * The slot a bill should get at the moment its tinting finishes.
 *
 * 🔴 THE CLOCK IS THE COMPLETION TIME, NOT THE ARRIVAL TIME. A tint bill that
 * arrived at 09:00 and finished at 15:40 cannot go out in the 10:30 window —
 * the paint did not exist then. Anchoring on arrival would schedule it into a
 * window that has already left. This is the same anchor CLAUDE_TINT.md's
 * slot-at-completion already uses for the pre-set case.
 *
 * 🔴 RETURNS null WHEN THE ENGINE DECLINES, AND THE CALLER MUST LEAVE THE SLOT
 * NULL. Do not substitute "today plus the next window". The engine declines for
 * four distinct reasons and they are not the same problem — `smu-not-deco-retail`
 * is a deliberate business gate, while `delivery-type-unhandled` is a
 * MASTER-DATA FAULT (a customer with no area, or an area with no delivery type)
 * that a default would hide forever. A bill with no slot is visible on both
 * boards and can be worked; a bill with a wrong slot is neither.
 *
 * ⚠ `dispatchStatus` IS PASSED AS "dispatch", WHICH IS NOT A BYPASS. The engine
 * gates on it so it can never slot a held or a cancelled bill, and that gate
 * stays. The caller has already established that this bill is NOT held and is
 * writing `'dispatch'` in the very same update — so the value passed here is the
 * one the row is about to hold, not a lie about the one it holds now. A caller
 * that has NOT established that must not call this function.
 */
export async function resolveCompletionSlot(
  orderId: number,
  completedAt: Date,
): Promise<CompletionSlot | null> {
  const order = await prisma.orders.findUnique({
    where: { id: orderId },
    select: {
      smu: true,
      customer: {
        select: { area: { select: { deliveryType: { select: { name: true } } } } },
      },
    },
  });
  if (!order) return null;

  const result = evaluateDispatchSlot({
    smu: order.smu,
    // See the 🔴 note above — the status this bill is about to carry.
    dispatchStatus: "dispatch",
    deliveryType: order.customer?.area?.deliveryType?.name ?? null,
    // ONE clock, deliberately. `pickEffectiveClock` exists to reconcile the
    // arrival email against the SAP punch; neither is the right anchor here, so
    // the completion moment is handed in as the only candidate and the
    // reconciliation is a no-op.
    emailDateTime: completedAt,
    punchDateTime: null,
  });

  if (!result.assigned) {
    console.log(
      `[completion-slot] orderId=${orderId} — no slot, engine declined: ${result.reason}`,
    );
    return null;
  }

  const window = await prisma.dispatch_slot_master.findFirst({
    where: { windowTime: result.windowTime, isActive: true },
    select: { id: true },
  });
  if (!window) {
    console.warn(
      `[completion-slot] No active dispatch_slot_master row for windowTime=${result.windowTime} — orderId=${orderId} left with no slot`,
    );
    return null;
  }

  console.log(
    `[completion-slot] orderId=${orderId} ruleId=${result.ruleId} targetDate=${result.targetDate.toISOString().slice(0, 10)} windowTime=${result.windowTime}`,
  );
  return {
    dispatchTargetDate: result.targetDate,
    dispatchWindowId: window.id,
    dispatchSlotRuleId: result.ruleId,
    dispatchSlotSource: "auto",
  };
}
