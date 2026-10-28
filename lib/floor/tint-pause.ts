// lib/floor/tint-pause.ts — the operator's CURRENT pause on a tint bill (2026-10-28).
//
// ONE owner for "is this bill paused, and why", read by both the board
// (lib/floor/queries.ts, batched over the page) and the detail panel
// (lib/floor/order-detail.ts, one bill). Before this, Floor showed a paused job
// as the solid pink "Tinting" pill: pause writes ONLY tint_assignments.status +
// a tint_pause_events row, never the order's stage (CLAUDE_TINT §5).
//
// THE RULE — the same one app/api/tint/operator/resume/route.ts uses to find the
// row it closes:
//   1. the bill is at `tinting_in_progress` (the stage check is mandatory — a
//      leftover `paused` assignment sits on a long-dispatched bill), AND
//   2. its LATEST whole-OBD assignment (splitId null, newest createdAt) is
//      TINT_STATUS_PAUSED, AND
//   3. the pause is that assignment's OPEN event (resumedAt null, newest pausedAt).
// Live check 2026-10-28: 0 paused assignments without an open event, 0 with two.
//
// SELECT-only. Sequential awaits. Costs nothing when no row is paused.

import { prisma } from "@/lib/prisma";
import { TINT_STATUS_PAUSED } from "@/lib/tint/assignment-status";
import type { FloorTintPause } from "./types";

const TINT_MIXING_STAGE = "tinting_in_progress";

/** Steps 1 and 2 of the rule, on facts the caller already holds. */
export function isPausedTintCandidate(workflowStage: string, assignmentStatus: string | null | undefined): boolean {
  return workflowStage === TINT_MIXING_STAGE && assignmentStatus === TINT_STATUS_PAUSED;
}

/**
 * Step 3: the open pause event per assignment, keyed by assignment id.
 * ONE query for any number of assignments; none when the list is empty.
 */
export async function getOpenTintPauses(assignmentIds: number[]): Promise<Map<number, FloorTintPause>> {
  const out = new Map<number, FloorTintPause>();
  if (assignmentIds.length === 0) return out;
  const events = await prisma.tint_pause_events.findMany({
    where: { assignmentId: { in: assignmentIds }, resumedAt: null },
    orderBy: { pausedAt: "desc" },
    select: {
      assignmentId: true,
      pauseReason: true,
      pauseRemark: true,
      pausedAt: true,
      operator: { select: { name: true } },
    },
  });
  // Newest first — the first row seen per assignment wins.
  for (const e of events) {
    if (out.has(e.assignmentId)) continue;
    out.set(e.assignmentId, {
      reason: e.pauseReason,
      remark: e.pauseRemark,
      by: e.operator?.name ?? null,
      at: e.pausedAt.toISOString(),
    });
  }
  return out;
}
