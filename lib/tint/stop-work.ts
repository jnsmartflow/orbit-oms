// lib/tint/stop-work.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 ONE OWNER FOR "END EVERY LIVE TINT JOB ON THIS BILL"
// ═══════════════════════════════════════════════════════════════════════════
//
// Tint Manager tabs build step 3 (2026-10-01) —
// docs/prompts/drafts/code-discovery-2026-10-01-tint-manager-build-plan.md §D.
//
// Callers:
//   - app/api/tint/manager/cancel (Stop & cancel): BOTH parts, then the cancel;
//   - lib/floor/bill-actions.ts cancel arm, for every tint bill (Floor AND the
//     Tint Manager): the SPLITS part only — a waiting bill has no live
//     assignment, but a legacy partly-split one can carry live splits that a
//     cancel used to orphan (diagnosis §B);
//   - app/api/tint/manager/ci: both parts before a mid-tint Raise CI.
//
// 🔴 NO orders WRITE, EVER. The bill's ONE orders.update (and its one
// order_status_logs row) is the caller's cancel. Every write here is to
// tint_assignments / order_splits / their own logs, whose @updatedAt already
// moves the Tint Manager marker.
//
// 🔴 IDEMPOTENT, so a partial failure heals on the next press. Each row is
// written by a GUARDED updateMany (id + the status we read): a second press
// finds nothing live and writes nothing — and a running timer is never folded
// twice.
//
// Sequential awaits, never prisma.$transaction (CORE §3). Server-only.

import { prisma } from "@/lib/prisma";
import {
  TINT_ASSIGNMENT_ACTIVE_STATUSES,
  TINT_SPLIT_LIVE_STATUSES,
  TINT_STATUS_CANCELLED,
} from "@/lib/tint/assignment-status";
import { minutesSinceRunStart } from "@/lib/tint/elapsed-time";

export interface StopTintWorkResult {
  assignmentsEnded: number;
  splitsCancelled: number;
}

/**
 * End this bill's live tint jobs.
 *
 *   (a) assignments — whole-OBD `tint_assignments` (splitId null) in an ACTIVE
 *       status → TINT_STATUS_CANCELLED. A RUNNING one folds its current run into
 *       `accumulatedMinutes` (the pause route's arithmetic,
 *       minutesSinceRunStart) so the timer reads frozen, as a pause would leave
 *       it; a paused or not-yet-started one changes status only.
 *       `currentProgress` is kept — the record of what was mixed. One tint_logs
 *       row "assignment_stopped" per row ended.
 *   (b) splits — `order_splits` in a live status → cancelled, sequenceOrder 0,
 *       one split_status_logs + one tint_logs "split_cancelled" each.
 *       split_line_items are NOT deleted (unlike splits/cancel): the bill is
 *       dying, no qty needs freeing, and the rows are the record. The PARENT
 *       stage is NOT touched.
 *
 * `parts` picks which halves run (default both). `note` goes on every log row.
 */
export async function stopTintWork(args: {
  orderId: number;
  managerId: number;
  note: string;
  parts?: { assignments?: boolean; splits?: boolean };
}): Promise<StopTintWorkResult> {
  const { orderId, managerId, note } = args;
  const doAssignments = args.parts?.assignments ?? true;
  const doSplits = args.parts?.splits ?? true;
  let assignmentsEnded = 0;
  let splitsCancelled = 0;

  // ── (a) the live whole-OBD assignment(s) ──────────────────────────────────
  if (doAssignments) {
    const live = await prisma.tint_assignments.findMany({
      where: { orderId, splitId: null, status: { in: [...TINT_ASSIGNMENT_ACTIVE_STATUSES] } },
      select: { id: true, status: true, startedAt: true, lastPausedAt: true, accumulatedMinutes: true },
      orderBy: { id: "asc" },
    });
    for (const asg of live) {
      const now = new Date();
      // Fold only a RUNNING timer. "paused" is already frozen; "assigned" never
      // started. A running row with no startedAt cannot be measured — status only.
      const running = asg.status === "tinting_in_progress" && asg.startedAt !== null;
      const accumulatedMinutes = running
        ? asg.accumulatedMinutes + minutesSinceRunStart({ startedAt: asg.startedAt as Date, lastPausedAt: asg.lastPausedAt }, now)
        : asg.accumulatedMinutes;
      // Guarded on the status we read: a concurrent pause/resume/done, or a
      // second press, makes this match nothing rather than double-fold.
      const res = await prisma.tint_assignments.updateMany({
        where: { id: asg.id, status: asg.status },
        data: { status: TINT_STATUS_CANCELLED, accumulatedMinutes },
      });
      if (res.count === 0) continue;
      assignmentsEnded += 1;
      await prisma.tint_logs.create({
        data: {
          orderId,
          action: "assignment_stopped",
          performedById: managerId,
          note: `${note} (was ${asg.status}${running ? `, timer frozen at ${accumulatedMinutes}m` : ""})`,
        },
      });
    }
  }

  // ── (b) live splits ────────────────────────────────────────────────────────
  if (doSplits) {
    const splits = await prisma.order_splits.findMany({
      where: { orderId, status: { in: [...TINT_SPLIT_LIVE_STATUSES] } },
      select: { id: true, status: true, splitNumber: true },
      orderBy: { id: "asc" },
    });
    for (const split of splits) {
      const res = await prisma.order_splits.updateMany({
        where: { id: split.id, status: split.status },
        data: { status: TINT_STATUS_CANCELLED, sequenceOrder: 0 },
      });
      if (res.count === 0) continue;
      splitsCancelled += 1;
      // INSERT-ONLY audit rows, the same pair splits/cancel writes.
      await prisma.split_status_logs.create({
        data: {
          splitId: split.id,
          fromStage: split.status,
          toStage: TINT_STATUS_CANCELLED,
          changedById: managerId,
          note: `Split #${split.splitNumber} cancelled — ${note}`,
        },
      });
      await prisma.tint_logs.create({
        data: {
          orderId,
          splitId: split.id,
          action: "split_cancelled",
          performedById: managerId,
          note: `Split #${split.splitNumber} cancelled — ${note}`,
        },
      });
    }
  }

  return { assignmentsEnded, splitsCancelled };
}

/** Does this bill still carry a live tint job (assignment or split)? Read-only. */
export async function hasLiveTintWork(orderId: number): Promise<boolean> {
  const asg = await prisma.tint_assignments.count({
    where: { orderId, splitId: null, status: { in: [...TINT_ASSIGNMENT_ACTIVE_STATUSES] } },
  });
  if (asg > 0) return true;
  const splits = await prisma.order_splits.count({
    where: { orderId, status: { in: [...TINT_SPLIT_LIVE_STATUSES] } },
  });
  return splits > 0;
}
