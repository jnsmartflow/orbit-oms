// Tint assignment status vocabulary — the ONE place the live values are named.
//
// `tint_assignments.status` and `order_splits.status` are plain `String` columns
// with a Prisma default of "assigned" / "tint_assigned" and NO database CHECK
// constraint, so a wrong literal is never rejected — it just silently matches
// nothing. That is exactly what happened: three routes filtered on
// `status: { not: "done" }` for years, and `"done"` is not a value this system
// has ever written.
//
// VERIFIED LIVE 2026-09-05 (read-only SELECT, CORE §3):
//   tint_assignments.status → tinting_done 907 · cancelled 64 · skipped 10 · assigned 6
//   order_splits.status     → cancelled 5 · tinting_done 4
// `paused` and `tinting_in_progress` are real values (written by
// app/api/tint/operator/pause|start|resume) that simply had no rows at the
// moment of the count. `done` returned ZERO rows.
//
// Write sites, for anyone adding a value here:
//   assigned            ← app/api/tint/manager/assign/route.ts
//   tinting_in_progress ← app/api/tint/operator/{start,resume}/route.ts
//   paused              ← app/api/tint/operator/pause/route.ts
//   skipped             ← app/api/tint/operator/skip/route.ts
//   tinting_done        ← app/api/tint/operator/{done,split/done}/route.ts
//   cancelled           ← app/api/tint/manager/{cancel-assignment,splits/cancel}/route.ts

/**
 * The operator's LIVE claim on an OBD. At most one assignment row per order
 * should sit in one of these at any moment.
 *
 * `skipped` is deliberately NOT here: a skip re-queues the order
 * (`app/api/tint/operator/skip/route.ts` clears the operator FK, nulls
 * `sequenceOrder` and resets `workflowStage` to `pending_tint_assignment`), and
 * the next Assign creates a BRAND NEW row rather than reviving the skipped one —
 * `assign/route.ts` looks for `status: "assigned"`, which a skipped row is not.
 * So a skipped row is history: it still carries `assignedToId`, but that person
 * no longer owns the job. Treating it as live is what let one OBD show up in two
 * different operators' reorder queues at once.
 */
export const TINT_ASSIGNMENT_ACTIVE_STATUSES = [
  "assigned",
  "tinting_in_progress",
  "paused",
] as const;

/**
 * Terminal / dead rows — history, never the current claim.
 * Kept as the explicit complement of the list above so a future value added to
 * one and not the other is obvious in review.
 */
export const TINT_ASSIGNMENT_DEAD_STATUSES = [
  "tinting_done",
  "cancelled",
  "skipped",
] as const;

/** The finished value. NOT `"done"` — that literal has never existed. */
export const TINT_STATUS_DONE = "tinting_done";

/** Whole-OBD and split cancellation. */
export const TINT_STATUS_CANCELLED = "cancelled";
