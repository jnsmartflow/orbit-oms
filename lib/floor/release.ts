// lib/floor/release.ts
//
// THE release write. What it means to send a bill to the picking floor.
//
// 🔴 ONE CALLER: POST /api/floor/release (the rail, the Hold tab and the detail
// panel's Release). Extracted 2026-09-10 so the trip module's Release could do
// the same write; that second caller, POST /api/floor/trips/[id]/release, was
// DELETED in slice 3 (2026-09-14) under the rule NO TRIP ACTION MAY CHANGE A
// BILL'S STATUS OR ITS HOLD. Its trip-only option (`skipAlreadyReleased`) and
// bucket (`alreadyReleased`) went with it.
//
// 🔴 DO NOT ADD A TRIP CALLER BACK. A bill reaches the floor through the
// import's auto-dispatch or through this write, pressed on the floor next to
// the bill. The file stays a module rather than folding into the route because
// "what does releasing mean" is still one rule with one owner.
//
// ⚠ WHAT A RELEASE IS, in one place: the slot, the status, the stage and the
// provenance, in ONE `orders.update`, plus ONE `order_status_logs` row.
//   dispatchTargetDate  — the day it is due out
//   dispatchWindowId    — the window it is due in
//   dispatchStatus      — 'dispatch'
//   workflowStage       — SUPPORT_DONE_OUTPUT (pending_picking)
//   dispatchSlotSource  — 'manual', which is what stops a later re-enrichment
//                         overwriting a human's chosen slot (the engine skips
//                         'manual' — CORE §7.4)
//
// ── A HELD BILL AT A PICKER STAGE (owner decision 2026-10-01) ──────────────
// Hold flips `dispatchStatus` only, so a bill held while a picker had it sits
// on the Hold tab at `pick_assigned` / `pick_done` / `pick_checked`. Release
// used to refuse all three ("Not releasable at stage …") and the hold could
// never be cleared from the floor. Now, for a HELD bill only:
//   pick_assigned → the picker is REMOVED and the bill is released fresh: the
//                   full write above (slot, status, stage, provenance) through
//                   the shared unassign helper (lib/picking/unassign.ts), which
//                   also deletes the pick_assignments row — no "Already
//                   assigned" trap. Outcome `picker_removed`.
//   pick_done /   → the hold is cleared and NOTHING else: `dispatchStatus`
//   pick_checked    'dispatch', stage / slot / assignment untouched (the slot
//                   the operator picked is ignored). Log note
//                   FLOOR_CLEAR_HOLD_NOTE. Outcome `hold_cleared`.
// A picker-stage bill that is NOT held is still refused, as before.
// FLOOR_RELEASABLE_STAGES is unchanged — these branches run before it.
//
// ⚠ EXACTLY ONE `orders.update` PER BILL. The live-sync markers key on
// MAX(orders.updatedAt), so a second write fires a false "changed" on every
// board in the depot (FLOOR §4/§10, PICKING §10).
//
// ⚠ EXACTLY ONE `order_status_logs` ROW PER BILL, and `fromStage` is the bill's
// REAL prior stage. Hardcoding "pending_support" would mislabel a Hold-tab
// release, whose bills sit at `pending_picking` — hold flips the STATUS only and
// never the stage (FLOOR §4.5).
//
// Sequential awaits, never prisma.$transaction (CORE §3).

import { prisma } from "@/lib/prisma";
import { SUPPORT_DONE_OUTPUT, PICK_ASSIGNED, PICK_DONE, PICK_CHECKED } from "@/lib/workflow-stages";
import { FLOOR_RELEASABLE_STAGES } from "./release-stages";
import { FLOOR_CLEAR_HOLD_NOTE } from "./hold-log";
import { findLiveCi, liveCiRefusal } from "@/lib/ci/live-ci";
import { returnAssignedBillToQueue } from "@/lib/picking/unassign";

export interface ReleaseFailure {
  orderId: number;
  error: string;
}

/** What Release did to one bill (2026-10-01).
 *   released       — the classic release: slot, status, stage, provenance.
 *   picker_removed — held at pick_assigned: the picker was removed AND the bill
 *                    was released fresh (same columns as `released`).
 *   hold_cleared   — held at pick_done / pick_checked: dispatchStatus only. */
export type ReleaseBillOutcome = "released" | "picker_removed" | "hold_cleared";

/** Held bills at these stages have their hold cleared and nothing else. Written
 *  out, never derived: a new picking stage must be a decision to admit here. */
const HOLD_CLEAR_ONLY_STAGES: string[] = [PICK_DONE, PICK_CHECKED];

export interface ReleaseOutcome {
  /** Every bill that was WRITTEN, whatever the kind — `outcomes` says which.
   *  Kept as the "anything written?" set so the callers' 422 rule is unchanged. */
  released: number[];
  /** One entry per written bill. */
  outcomes: Array<{ orderId: number; outcome: ReleaseBillOutcome }>;
  /**
   * Skipped because the bill is mid-tint — NOT an error.
   *
   * 🔴 THE OWNER'S RULE: a tint bill may sit on a trip and simply does not
   * release until its shades are done. `FLOOR_RELEASABLE_STAGES` deliberately
   * excludes `pending_tint_assignment`, `tint_assigned` and
   * `tinting_in_progress` so a bill can never reach a rack with no shade
   * (FLOOR §4.2), and that exclusion is kept. What changes is how it is
   * REPORTED: a mid-tint bill is a bill waiting its turn, not a failure, and
   * the caller re-runs the release later to catch it up.
   */
  waitingForTint: Array<{ orderId: number; workflowStage: string }>;
  /** A real failure — not found, removed, or a stage that is not a tint stage. */
  failed: ReleaseFailure[];
}

/**
 * The stages a bill can be at while its shades are still being made.
 *
 * ⚠ DERIVED FROM NOTHING — written out, deliberately. It is the complement of
 * `FLOOR_RELEASABLE_STAGES` only by coincidence today, and a rank-based
 * derivation would silently absorb any new mid-pipeline stage into "waiting for
 * tint", which is a claim about paint that a rank cannot make. Three names, one
 * meaning; a fourth needs a person to decide it belongs here.
 */
const TINT_IN_PROGRESS_STAGES = new Set<string>([
  "pending_tint_assignment",
  "tint_assigned",
  "tinting_in_progress",
]);

/**
 * Release a set of bills to the floor, all onto the SAME slot.
 *
 * `targetDate` + `windowId` are the slot every released bill receives. The one
 * caller passes the slot the operator picked per bill, and so calls this once
 * per bill — see that route.
 *
 * ⚠ A BILL ALREADY AT `pending_picking` IS REWRITTEN, deliberately. The Hold
 * tab's bills sit there with `dispatchStatus: 'hold'`, and releasing one MUST
 * flip it back — the whole point of `pending_picking` being in
 * FLOOR_RELEASABLE_STAGES, and the silent-no-op bug FLOOR §6(b) records.
 */
export async function releaseBillsToFloor(opts: {
  orderIds: number[];
  /** The slot every released bill receives. UTC-midnight anchored (@db.Date). */
  targetDate: Date;
  windowId: number;
  /** For the log note only — e.g. "12:30". */
  windowLabel: string;
  /** The real session user. Never a body claim. */
  actorId: number;
  /** A note prefix for the log row, so each caller says where it came from. */
  noteLabel: string;
}): Promise<ReleaseOutcome> {
  const { orderIds, targetDate, windowId, windowLabel, actorId, noteLabel } = opts;

  const released: number[] = [];
  const outcomes: Array<{ orderId: number; outcome: ReleaseBillOutcome }> = [];
  const waitingForTint: Array<{ orderId: number; workflowStage: string }> = [];
  const failed: ReleaseFailure[] = [];

  for (const orderId of orderIds) {
    try {
      const order = await prisma.orders.findUnique({
        where: { id: orderId },
        select: { id: true, workflowStage: true, dispatchStatus: true, isRemoved: true },
      });
      if (!order || order.isRemoved) {
        failed.push({ orderId, error: "Order not found" });
        continue;
      }

      // 🔴 A bill carrying a LIVE CI is never released (2026-09-24, design
      // web-update-2026-09-24-billing-mo-actions.md §3.7). Its goods are being
      // booked back on billing's desk; releasing it would put them in front of a
      // picker. A bill-only bill whose cancel failed sits held with its CI —
      // Floor finishes it with a plain Cancel, not a Release.
      const liveCi = await findLiveCi(orderId);
      if (liveCi !== null) {
        failed.push({ orderId, error: liveCiRefusal(liveCi, "released") });
        continue;
      }

      // Mid-tint — skipped, NOT failed. Checked BEFORE the releasable test
      // so the reason reaching the caller is "waiting for tint" rather than the
      // generic "not releasable at stage X", which is true but useless.
      if (TINT_IN_PROGRESS_STAGES.has(order.workflowStage)) {
        waitingForTint.push({ orderId, workflowStage: order.workflowStage });
        continue;
      }

      const isHeld = order.dispatchStatus === "hold";

      // HELD AT pick_assigned — remove the picker, release fresh. ONE
      // orders.update (the helper's, carrying the slot) + the assignment delete
      // after it, then ONE log row that names both halves of the move.
      if (isHeld && order.workflowStage === PICK_ASSIGNED) {
        // A read only — the picker's name for the log, before the row goes.
        const pa = await prisma.pick_assignments.findUnique({
          where: { orderId },
          select: { picker: { select: { name: true } } },
        });
        await returnAssignedBillToQueue(
          orderId,
          {
            dispatchTargetDate: targetDate,
            dispatchWindowId: windowId,
            dispatchStatus: "dispatch",
            dispatchSlotSource: "manual",
          },
          "floor/release",
        );
        await prisma.order_status_logs.create({
          data: {
            orderId,
            fromStage: order.workflowStage,
            toStage: SUPPORT_DONE_OUTPUT,
            changedById: actorId,
            note: `${noteLabel} · picker removed (${pa?.picker?.name ?? "none on record"}) · ${targetDate.toISOString().slice(0, 10)} ${windowLabel}`,
          },
        });
        released.push(orderId);
        outcomes.push({ orderId, outcome: "picker_removed" });
        continue;
      }

      // HELD AT pick_done / pick_checked — clear the hold, nothing else. The
      // stage is untouched, so toStage = fromStage and the NOTE identifies the
      // event (the same note as Floor's unhold — kept out of HOLD_LOG_NOTES).
      if (isHeld && HOLD_CLEAR_ONLY_STAGES.includes(order.workflowStage)) {
        await prisma.orders.update({
          where: { id: orderId },
          data: { dispatchStatus: "dispatch" },
        });
        await prisma.order_status_logs.create({
          data: {
            orderId,
            fromStage: order.workflowStage,
            toStage: order.workflowStage,
            changedById: actorId,
            note: FLOOR_CLEAR_HOLD_NOTE,
          },
        });
        released.push(orderId);
        outcomes.push({ orderId, outcome: "hold_cleared" });
        continue;
      }

      // Anything else outside the list is a real refusal — a cancelled bill, a
      // dispatched one, a stage nobody has taught this path about.
      if (!FLOOR_RELEASABLE_STAGES.includes(order.workflowStage)) {
        failed.push({ orderId, error: `Not releasable at stage ${order.workflowStage}` });
        continue;
      }

      // ONE orders.update. See the header for why each column is here.
      await prisma.orders.update({
        where: { id: orderId },
        data: {
          dispatchTargetDate: targetDate,
          dispatchWindowId: windowId,
          dispatchStatus: "dispatch",
          workflowStage: SUPPORT_DONE_OUTPUT,
          dispatchSlotSource: "manual",
        },
      });

      // ONE log row. `fromStage` is the REAL prior stage.
      await prisma.order_status_logs.create({
        data: {
          orderId,
          fromStage: order.workflowStage,
          toStage: SUPPORT_DONE_OUTPUT,
          changedById: actorId,
          note: `${noteLabel} · ${targetDate.toISOString().slice(0, 10)} ${windowLabel}`,
        },
      });

      released.push(orderId);
      outcomes.push({ orderId, outcome: "released" });
    } catch (err) {
      failed.push({ orderId, error: err instanceof Error ? err.message : "Unexpected error" });
    }
  }

  return { released, outcomes, waitingForTint, failed };
}
