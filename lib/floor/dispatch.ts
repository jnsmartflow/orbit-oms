// lib/floor/dispatch.ts
//
// THE dispatch write. What it means to say a bill has left the depot.
//
// 🔴 WHY THIS EXISTS AT ALL. Nothing in Orbit has ever written `dispatched`.
// The stage has been reached 7,067 times and `order_status_logs` records the
// transition 244 times — the newest of those from 2026-08-27. Every other one
// came from a hand-run UPDATE in the SQL editor, which writes no log row, so the
// app cannot say who shipped what or when, and an undo table had to be kept by
// hand. The most recent sweep was 2026-09-13 12:58:49 UTC: 21 trips and 136
// bills moved in a single second, with zero log rows between them.
//
// That is the hole this module closes. Every transition through here leaves a
// trace, like any other stage change in the system.
//
// 🔴 ONE OWNER PER BEHAVIOUR, the same discipline that put the release write in
// lib/floor/release.ts rather than in the route that happened to need it first.
// One caller today (POST /api/floor/trips/[id]/dispatch). A second copy of "what
// does dispatched mean" is two answers on the same column, and the copy is
// always the one that misses the next rule change.
//
// ─────────────────────────────────────────────────────────────────────────
// 🔴 WHERE THIS IS CALLED FROM IS TEMPORARY. READ THIS BEFORE BUILDING ON IT.
//
// The WRITE below is permanent — this is what dispatching a bill means, and it
// keeps that job. What is temporary is its CALLER. Confirming a trip marks
// dispatch only because Orbit has no loading or dispatch screen yet; until it
// does, "Confirm plan" is the last thing the depot presses before the truck
// goes, and the stage was otherwise being written every evening by hand from an
// NTS spreadsheet with no audit trail at all.
//
// WHEN THE LOADING SCREEN IS BUILT (a few weeks out, as of 2026-09-13), the
// dispatch mark MOVES THERE and comes off the confirm. This module is where it
// moves FROM, not a statement that confirming and dispatching are the same act.
// They are not, and the depot should not learn that they are.
//
// ⚠ WHICH IS WHY THE BUTTON IS STILL CALLED "Confirm plan". Renaming it to
// "Confirm & mark dispatched" was considered and rejected on exactly this
// ground: a button named after a side effect that is scheduled to be taken away
// teaches a word with an expiry date, and confirming the plan is the button's
// real job either way. The consequence is told in the caption and in the
// confirmation prompt instead (lib/floor/trip-wording.ts, and `releaseTrip` in
// components/floor/floor-page.tsx). Owner decision — do not "tidy" the label.
//
// A future session must not read the confirm→dispatch wiring as the permanent
// design. The rules in this file are; the call site is a stopgap with a date.
// ─────────────────────────────────────────────────────────────────────────
//
// ⚠ WHAT A DISPATCH IS, in one place: ONE column, in ONE `orders.update`, plus
// ONE `order_status_logs` row.
//   workflowStage — DISPATCHED, and nothing else
//
// ⚠ WHAT IT DELIBERATELY DOES NOT TOUCH:
//   dispatchStatus — 'dispatch' is a DECISION ("this bill is going out"), not a
//                    stage. It stays exactly as it is; the ladder carries the
//                    fact that the goods have gone.
//   tripDropId     — the bill stays on its trip. That pointer is how the desk
//                    still shows it under its stop, and how the trip's counts
//                    stay whole after the load leaves.
//   pickVisibleAt  — untouched, same reason the cancel route leaves it alone.
//
// ⚠ EXACTLY ONE `orders.update` PER BILL. The live-sync markers key on
// MAX(orders.updatedAt), so a second write fires a false "changed" on every
// board in the depot (FLOOR §4/§10, PICKING §10).
//
// Sequential awaits, never prisma.$transaction (CORE §3).

import { prisma } from "@/lib/prisma";
import { DISPATCHED, PICK_CHECKED } from "@/lib/workflow-stages";

export interface DispatchFailure {
  orderId: number;
  error: string;
}

export interface DispatchOutcome {
  /** The write happened: stage moved to `dispatched`, and a log row exists. */
  dispatched: number[];
  /** Already at `dispatched` — nothing to do, and NOT a failure. */
  alreadyDispatched: number[];
  /**
   * 🔴 LEFT ALONE ON PURPOSE, AND THE MOST IMPORTANT BUCKET IN THIS FILE.
   *
   * A bill that is not at `pick_checked` HAS NOT SHIPPED. It is still being
   * picked, or still on the bench waiting for a supervisor to check it, and the
   * goods are physically in the building. Marking it dispatched would be a
   * false record of stock that is still on the shelf — the one thing a stage
   * called "dispatched" must never say.
   *
   * It carries the STAGE, not just the id, because the caller has to be able to
   * tell the operator WHY a bill was left behind. "3 not dispatched" invites a
   * second press; "3 still being picked" does not.
   *
   * Measured 2026-09-13: across all 55 trips ever confirmed, 136 of 138 bills
   * (98.6%) were at `pick_checked` at the moment of confirming. ONE trip held
   * the other two. At that rate nobody is watching for this, which is exactly
   * why it is a named bucket and not a silent skip.
   */
  notChecked: Array<{ orderId: number; workflowStage: string }>;
  /**
   * 🔴 A HELD BILL IS NEVER DISPATCHED, WHATEVER THE TRIP SAYS.
   *
   * `dispatchStatus: 'hold'` is a human saying "this one does not go", and it
   * outranks the trip it happens to be sitting on. Hold is a STATUS and not a
   * stage (FLOOR §4.5), so a held bill can be at `pick_checked` and would sail
   * through a stage-only test — which is why this is checked first and kept as
   * its own bucket rather than folded into `notChecked`.
   *
   * Zero held bills are on any trip today. The guard is here because the day one
   * is, nobody will remember that a trip does not overrule a hold.
   */
  held: number[];
  /** A real failure — not found, removed, or the write threw. */
  failed: DispatchFailure[];
}

/**
 * Mark a set of bills dispatched — the goods are on the truck and gone.
 *
 * ⚠ ONLY `pick_checked` MOVES. Everything else is bucketed and reported, never
 * written. Read `notChecked` above before relaxing that.
 *
 * @param noteLabel prefix for the log row, so every caller says where it came
 *        from — e.g. "Dispatched with trip L-260912-08".
 */
export async function markBillsDispatched(opts: {
  orderIds: number[];
  /** The real session user. Never a body claim. */
  actorId: number;
  noteLabel: string;
}): Promise<DispatchOutcome> {
  const { orderIds, actorId, noteLabel } = opts;

  const dispatched: number[] = [];
  const alreadyDispatched: number[] = [];
  const notChecked: Array<{ orderId: number; workflowStage: string }> = [];
  const held: number[] = [];
  const failed: DispatchFailure[] = [];

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

      // Already gone. A re-run of a confirm must not write a second log row
      // claiming it shipped twice.
      if (order.workflowStage === DISPATCHED) {
        alreadyDispatched.push(orderId);
        continue;
      }

      // A hold outranks the trip. Checked FIRST — a held bill can be at
      // `pick_checked` and would otherwise pass the stage test below.
      if (order.dispatchStatus === "hold") {
        held.push(orderId);
        continue;
      }

      // The rule. Anything short of checked is still in the building.
      if (order.workflowStage !== PICK_CHECKED) {
        notChecked.push({ orderId, workflowStage: order.workflowStage });
        continue;
      }

      // ONE orders.update. ONE column — see the header for what is deliberately
      // left alone.
      await prisma.orders.update({
        where: { id: orderId },
        data: { workflowStage: DISPATCHED },
      });

      // ONE log row, and the whole point of this module. `fromStage` is the
      // bill's REAL prior stage, which the guard above has already pinned to
      // PICK_CHECKED — read from the row rather than hardcoded, so it stays
      // honest if that guard ever widens.
      await prisma.order_status_logs.create({
        data: {
          orderId,
          fromStage: order.workflowStage,
          toStage: DISPATCHED,
          changedById: actorId,
          note: noteLabel,
        },
      });

      dispatched.push(orderId);
    } catch (err) {
      failed.push({ orderId, error: err instanceof Error ? err.message : "Unexpected error" });
    }
  }

  return { dispatched, alreadyDispatched, notChecked, held, failed };
}
