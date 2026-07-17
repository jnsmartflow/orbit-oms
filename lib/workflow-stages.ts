// ─────────────────────────────────────────────────────────────────────────
// Central stage registry for `orders.workflowStage` (a plain String column,
// never a Postgres enum — see prisma/schema.prisma). This is the ONE place
// that encodes the stage LADDER: the order stages happen in, and who may
// touch an order at each rung. Every consumer asks the ladder a POSITION
// question ("is this stage at or past rank 60?") instead of maintaining its
// own hand-written array of stage names — the exact bug class that put a
// correctly-LOCKED 'pick_assigned' order back on Support's active board
// wearing a Dispatch pill (it was in one array but not the other).
//
// Today only Support reads this file. When Tint Manager and the picker view
// are migrated onto the same registry, each gains its OWN flag column
// (tintMayEdit, pickingMayEdit) — a column addition to StageDef, never a
// rewrite of the ladder itself. Those columns are NOT added yet; their
// rules haven't been decided.
// ─────────────────────────────────────────────────────────────────────────

export type StageDef = {
  stage: string;           // exact DB value
  rank: number | null;     // null for terminal stages (cancelled)
  label: string;           // human-readable; not wired to any UI yet
  terminal?: true;         // cancelled only
  supportMayEdit: boolean; // a PLAIN FLAG per stage — never derived from rank
};

// Ranks are spaced by ten so a future stage slots in without renumbering —
// pick_done (80) and pick_checked (90) landed exactly that way on
// 2026-07-17, pushing dispatched from 90 to 100 with no other file needing
// a change (see the export list below for why). 'pending_picking' and
// 'closed' deliberately SHARE
// rank 60 — a legacy order must behave identically to a new one. 'closed' is
// legacy only: nothing writes it any more (see SUPPORT_DONE_OUTPUT below).
//
// The shape is locked at 30-40 (mid-tint), unlocked at 50-60 (Support's own
// territory), locked again from 70 (picker has it) — a hole in the middle.
// supportMayEdit is a flag per row, not a threshold, because of that hole:
// do not collapse it into "rank >= X" or "rank <= X".
export const STAGE_LADDER: StageDef[] = [
  { stage: "order_created",           rank: 10, label: "Created",                supportMayEdit: true },
  { stage: "pending_tint_assignment", rank: 20, label: "Awaiting Tint",          supportMayEdit: true },
  { stage: "tint_assigned",           rank: 30, label: "Tint Assigned",          supportMayEdit: false },
  { stage: "tinting_in_progress",     rank: 40, label: "Tinting",                supportMayEdit: false },
  { stage: "pending_support",         rank: 50, label: "Awaiting Support",       supportMayEdit: true },
  { stage: "pending_picking",         rank: 60, label: "In Picking Queue",       supportMayEdit: true },
  { stage: "closed",                  rank: 60, label: "In Picking Queue (old)", supportMayEdit: true },
  { stage: "pick_assigned",           rank: 70, label: "Assigned to Picker",     supportMayEdit: false },
  // Stage 2 foundation (2026-07-17) — schema columns exist (pick_assignments
  // .checkedAt/.checkedById) but nothing writes these stages yet. Both are
  // hand-set false, NOT inherited from rank (see the file-top comment) —
  // Support must stay locked out of a bill the picker is physically holding.
  { stage: "pick_done",               rank: 80, label: "Picked",                 supportMayEdit: false },
  { stage: "pick_checked",            rank: 90, label: "Checked",                supportMayEdit: false },
  { stage: "dispatched",              rank: 100, label: "Dispatched",            supportMayEdit: false },
  { stage: "cancelled", rank: null, label: "Cancelled", terminal: true, supportMayEdit: false },
];

/** The stage Support (and its automated equivalents, e.g. mail-order
 *  auto-dispatch) writes TODAY when it dispatches an order. Only this one,
 *  current value — never the historical ones — because consumers like
 *  /picking must see only NEW dispatches, not resurrect old 'closed' rows. */
export const SUPPORT_DONE_OUTPUT = "pending_picking";

/** The stage the (not-yet-built) Assigned button will write. */
export const PICK_ASSIGNED = "pick_assigned";

/** The stage the (not-yet-built) picker Done action will write. */
export const PICK_DONE = "pick_done";

/** The stage the (not-yet-built) supervisor Approve action will write. */
export const PICK_CHECKED = "pick_checked";

/** Position of a stage on the ladder. null for BOTH unknown stages and
 *  explicitly off-ladder terminal stages ('cancelled') — callers must not
 *  read null as "unknown"; use isSupportDone() to test cancelled by name. */
export function stageRank(stage: string | null): number | null {
  if (stage === null) return null;
  const def = STAGE_LADDER.find((d) => d.stage === stage);
  return def?.rank ?? null;
}

/** May Support mutate (dispatch/release/hold/cancel) an order at this stage?
 *  Fails CLOSED: an unknown or null stage returns false, never true — a
 *  typo'd or future stage this file hasn't been taught about must never be
 *  silently treated as editable. */
export function supportMayEdit(stage: string | null): boolean {
  if (stage === null) return false;
  const def = STAGE_LADDER.find((d) => d.stage === stage);
  return def?.supportMayEdit ?? false;
}

/**
 * Is Support done with this order? Must reproduce today's behaviour EXACTLY:
 *   - stage === 'cancelled'      → true
 *   - dispatchStatus === 'hold'  → true (hold is not a stage — a held order
 *                                  stays at pending_support; this arm is
 *                                  unrelated to the ladder and always existed)
 *   - rank >= 60                 → true
 *   - otherwise                  → false
 * Fails CLOSED: unknown or null stage → false.
 */
export function isSupportDone(
  stage: string | null,
  dispatchStatus: string | null,
): boolean {
  if (stage === null) return false;
  if (stage === "cancelled") return true;
  if (dispatchStatus === "hold") return true;

  const rank = stageRank(stage);
  if (rank === null) return false;
  return rank >= 60;
}

/**
 * Every stage at rank >= 60. DERIVED from the ladder, never hand-written;
 * recomputes automatically if the ladder changes. Used by list-query "is
 * this order done" filters across Support, Tint Manager, Operations, and
 * the two admin backfill tools.
 */
export const SUPPORT_DONE_STAGE_NAMES: string[] = STAGE_LADDER
  .filter((d) => d.rank !== null && d.rank >= 60)
  .map((d) => d.stage);

/**
 * NARROWER than SUPPORT_DONE_STAGE_NAMES — exactly rank 60 (pending_picking,
 * closed), excluding 'pick_done'/'pick_checked'/'dispatched' (ranks 80/90/100).
 * Also derived from the ladder, never hand-written.
 *
 * Exists because a handful of call sites' ORIGINAL arrays never included
 * "dispatched" alongside SUPPORT_DONE_STAGES, unlike every other consumer,
 * which always paired the spread with an explicit "dispatched" literal.
 * Migrating those sites to the wide SUPPORT_DONE_STAGE_NAMES would silently
 * widen their match to include 'dispatched' — a real (currently inert —
 * zero production order has ever reached 'dispatched'; the Planning pipeline
 * that writes it requires 'dispatch_confirmation', a stage nothing in this
 * codebase writes yet) behaviour change. Reviewed and accepted by Smart Flow
 * as an intentional, currently-inert divergence from the old ad-hoc arrays
 * (2026-07 ladder migration). Used only at:
 *   - app/api/support/orders/route.ts — the "hold released" and
 *     "dispatch-target-date" history footprint arms (both the single-slot
 *     and ALL-slot variants)
 *   - app/api/admin/fix-challans/route.ts — its eligible-orders filter
 */
export const SUPPORT_PICKING_QUEUE_STAGE_NAMES: string[] = STAGE_LADDER
  .filter((d) => d.rank === 60)
  .map((d) => d.stage);
