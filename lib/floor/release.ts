// lib/floor/release.ts
//
// THE release write. What it means to send a bill to the picking floor.
//
// 🔴 ONE OWNER PER BEHAVIOUR. Extracted 2026-09-10 from
// app/api/floor/release/route.ts so the trip module's Release can do the SAME
// thing instead of a second version of it. Two callers now:
//   - POST /api/floor/release              (the rail and the Hold tab)
//   - POST /api/floor/trips/[id]/release   (a whole trip)
// A second copy of a release rule is two answers to "what does releasing mean",
// on the same columns, and the second copy is always the one that misses the
// next change. The same discipline that put `stampPickVisibility` in
// lib/picking/visibility-gate.ts and `buildPickingWhere` in lib/picking/queue.ts.
//
// 🔴 THE BUG THIS EXISTS TO CLOSE, recorded so it is not reintroduced.
// Before this, the trip release called `stampPickVisibility` and NOTHING ELSE.
// That function refuses any bill not already at `SUPPORT_DONE_OUTPUT`, so a bill
// at `pending_support` put on a trip and released stayed at `pending_support`,
// kept `dispatchStatus` NULL, never reached the picking board — and came back in
// a bucket the route had labelled "already with a picker", which was false on
// screen. Diagnosis: code-discovery-2026-09-10-noslot-backlog.md §B5.
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
import { SUPPORT_DONE_OUTPUT } from "@/lib/workflow-stages";
import { FLOOR_RELEASABLE_STAGES } from "./release-stages";

export interface ReleaseFailure {
  orderId: number;
  error: string;
}

export interface ReleaseOutcome {
  /** The full write happened: slot, status, stage, provenance, and a log row. */
  released: number[];
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
 * `targetDate` + `windowId` are the slot every released bill receives. The trip
 * caller passes the trip's own; the rail caller passes the one the operator
 * picked per bill (and so calls this once per bill — see that route).
 *
 * 🔴 A BILL ALREADY RELEASED IS NOT REWRITTEN. `pending_picking` +
 * `dispatchStatus: 'dispatch'` means it is already on the floor with a slot
 * somebody chose — possibly deliberately, and possibly different from this
 * trip's. Rewriting it would silently move a bill's promised time because it
 * happened to be on a trip, and would burn an `orders.update` (and therefore a
 * false marker change) to do it. It comes back in `released` as a no-op only if
 * the caller asks for that; here it is simply left alone and reported by the
 * caller through the visibility stamp instead.
 *
 * ⚠ `skipAlreadyReleased` exists so the rail caller keeps its exact current
 * behaviour. `/api/floor/release` serves the Hold tab, where a bill AT
 * `pending_picking` with `dispatchStatus: 'hold'` MUST be rewritten — that is
 * the whole point of `pending_picking` being in FLOOR_RELEASABLE_STAGES, and
 * the silent-no-op bug FLOOR §6(b) records. So the rail passes `false`, and only
 * the trip caller passes `true`.
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
  /**
   * Leave an already-released bill alone rather than rewriting its slot.
   * TRUE for the trip caller (c), FALSE for the rail/Hold caller.
   */
  skipAlreadyReleased?: boolean;
}): Promise<ReleaseOutcome & { alreadyReleased: number[] }> {
  const {
    orderIds,
    targetDate,
    windowId,
    windowLabel,
    actorId,
    noteLabel,
    skipAlreadyReleased = false,
  } = opts;

  const released: number[] = [];
  const alreadyReleased: number[] = [];
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

      // (c) Already on the floor with a slot — leave it exactly as it is.
      if (
        skipAlreadyReleased &&
        order.workflowStage === SUPPORT_DONE_OUTPUT &&
        order.dispatchStatus === "dispatch"
      ) {
        alreadyReleased.push(orderId);
        continue;
      }

      // (d) Mid-tint — skipped, NOT failed. Checked BEFORE the releasable test
      // so the reason reaching the caller is "waiting for tint" rather than the
      // generic "not releasable at stage X", which is true but useless.
      if (TINT_IN_PROGRESS_STAGES.has(order.workflowStage)) {
        waitingForTint.push({ orderId, workflowStage: order.workflowStage });
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
    } catch (err) {
      failed.push({ orderId, error: err instanceof Error ? err.message : "Unexpected error" });
    }
  }

  return { released, alreadyReleased, waitingForTint, failed };
}
