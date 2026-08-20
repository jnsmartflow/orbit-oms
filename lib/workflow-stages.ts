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
 * widen their match to include 'dispatched' — a real behaviour change.
 *
 * ⚠ CORRECTED 2026-07-27 — this comment previously claimed "zero production
 * order has ever reached 'dispatched'" and that the change was therefore
 * "currently inert". BOTH WERE FALSE, and the error propagated: a discovery
 * report cited this comment and wrongly concluded the Warehouse AND Planning
 * boards could only ever render empty. Verified counts:
 *   - workflowStage 'dispatched'            = 1,546 rows (live SELECT 2026-07-27).
 *     ROADMAP recorded 1,051 on 2026-07-24 — ~500 rows moved in three days and
 *     HOW is not currently understood. Not investigated here.
 *   - workflowStage 'dispatch_confirmation' = 0 rows. THAT half holds: nothing
 *     in this codebase writes 'dispatch_confirmation'.
 * So widening a match to include 'dispatched' would hit real rows today. Treat
 * this divergence as LIVE, not inert, when touching any of the call sites below.
 * The known workflow hole — no automatic drain pick_checked → dispatched — is
 * owned by docs/ROADMAP.md and CLAUDE_PICKING.md §9; not restated here.
 *
 * The divergence itself was reviewed and accepted by Smart Flow as intentional
 * (2026-07 ladder migration). Used only at:
 *   - app/api/support/orders/route.ts — the "hold released" and
 *     "dispatch-target-date" history footprint arms (both the single-slot
 *     and ALL-slot variants)
 *   - app/api/admin/fix-challans/route.ts — its eligible-orders filter
 */
export const SUPPORT_PICKING_QUEUE_STAGE_NAMES: string[] = STAGE_LADDER
  .filter((d) => d.rank === 60)
  .map((d) => d.stage);

/**
 * The stages /picking's queue reads, split into the two sets its two scopes
 * need. Composed from the constants above so the single-date and all-dates
 * scopes in lib/picking/queue.ts can never drift apart by construction —
 * PICKING_OPEN_STAGES is a strict subset of PICKING_ACTIVE_STAGES.
 *
 * ⚠ DELIBERATELY EXCLUDES 'closed', and this is NOT the hand-written-array
 * bug class the file-top comment warns about — it is the exact exclusion
 * SUPPORT_DONE_OUTPUT above exists to enforce ("consumers like /picking must
 * see only NEW dispatches, not resurrect old 'closed' rows"). Do NOT "fix"
 * this by deriving it from rank: 'closed' shares rank 60 with
 * 'pending_picking', so any rank-based derivation silently readmits it.
 *
 * The reason is DATA-VERIFIED, not an inference from the stage's name.
 * Read-only production census, 2026-07-20 — non-removed 'closed' rows with
 * dispatchStatus='dispatch' (i.e. board-eligible on every other predicate):
 *
 *     5,071 total   =   4,499 with dispatchTargetDate NULL
 *                     +   572 past-dated
 *                     +     0 today
 *                     +     0 future
 *
 * All 5,071 are legacy COMPLETED orders. None is live floor work: a NULL
 * dispatch date means the row never passed through the modern Support
 * dispatch flow at all (that flow requires dispatchTargetDate +
 * dispatchWindowId), and the 572 dated ones are all in the past. Scale
 * baseline from the same day: 18 'pending_picking' rows existed in total.
 *
 * Why this bites HARDER under the all-dates 'openPending' scope than under
 * the old single-date filter: the date fence used to hide every one of them.
 * Remove the fence and they are admitted en masse — and note the interaction
 * with the locked null-date rule in lib/picking/queue.ts, which maps a NULL
 * dispatchTargetDate to zone 'due' (unscheduled work must never hide behind
 * the lock). So the 4,499 null-date rows would not sit quietly in the
 * 'upcoming' zone; they would land directly in the DUE zone, on top of the
 * floor's live work, at roughly 250x the volume of the real queue.
 */
export const PICKING_OPEN_STAGES: string[] = [
  SUPPORT_DONE_OUTPUT,
  PICK_ASSIGNED,
  PICK_DONE,
];

/** PICKING_OPEN_STAGES + the terminal-for-picking checked stage. */
export const PICKING_ACTIVE_STAGES: string[] = [
  ...PICKING_OPEN_STAGES,
  PICK_CHECKED,
];

/**
 * Stages the supervisor board may CANCEL a bill from.
 *
 * ⚠ LIVES HERE, NOT IN THE ROUTE THAT ENFORCES IT. It was declared in
 * app/api/picking/cancel/route.ts when that route landed (3a); the ⋯ menu needs
 * the same list to decide whether to render at all, and a "use client"
 * component importing from a route module would drag prisma and next-auth into
 * the browser bundle. This file is pure (zero imports) and is already the owner
 * of every other picking stage set, so it is the correct home. The route
 * re-exports nothing — it imports from here, so there is exactly one list.
 *
 * ⚠ DELIBERATELY NARROWER THAN FLOOR'S CANCEL, which refuses only an
 * already-cancelled bill and will therefore kill one at `pick_checked` or even
 * `dispatched`. Picking refuses both: a checked bill has been ticked line by
 * line and signed off, and a dispatched one has left. Refusing is the
 * recoverable direction — Floor can still do it, and admitting a stage later is
 * one edit — while permitting is not, because the audit row is INSERT-ONLY.
 *
 * `pick_done` IS admitted even though the goods are physically staged: refusing
 * would leave the floor no way to kill a bill a customer cancelled while it sat
 * on the bench. The sheet's two-stage confirm (CLAUDE_UI.md §13) carries the
 * warning instead — the route is the backstop, the UI is the policy.
 */
export const PICKING_CANCELLABLE_STAGES: string[] = [
  SUPPORT_DONE_OUTPUT, // pending_picking — the Assign tab. Nobody holds it.
  PICK_ASSIGNED,       // a picker has it — the assignment row is cleared on cancel.
  PICK_DONE,           // picked, awaiting check — two-stage confirm in the UI.
];

/**
 * Recover a picking row's STAGE from the three booleans the queue payload
 * carries. `PickingQueueRow` (lib/picking/types.ts) deliberately ships
 * isAssigned / isDone / isChecked instead of `workflowStage`, so any consumer
 * that needs to ask a STAGE question — "may this bill be cancelled?" — has to
 * map back. This is the ONE place that mapping lives.
 *
 * 🔴 IT EXISTS SO NOBODY WRITES THE MAPPING INLINE AGAIN. The all-three-false
 * fall-through is the exact bug class this module's header warns about and that
 * has already bitten twice (pick_done, then pick_checked): a new stage is
 * `false` on every existing boolean, so an inline `!isAssigned && !isDone`
 * silently reads it as "still waiting". Composed from the exported constants,
 * never string literals, so a renamed stage moves everything at once.
 *
 * ⚠ THE FALL-THROUGH IS ONLY SAFE BECAUSE OF THE QUERY. All three false maps to
 * `pending_picking` — correct today ONLY because lib/picking/queue.ts's WHERE
 * admits exactly PICKING_ACTIVE_STAGES and nothing else, so a row reaching a
 * consumer cannot be `cancelled`, `dispatched`, or mid-tint. If that predicate
 * ever widens, this function must gain the corresponding flag FIRST — it cannot
 * infer a stage the payload does not describe.
 *
 * ⚠ `closed` (legacy, shares rank 60) also maps here to `pending_picking`, and
 * that is correct behaviour-wise — the two share a rank precisely so a legacy
 * order behaves identically — but note PICKING_OPEN_STAGES excludes `closed`,
 * so no such row reaches a board in the first place.
 */
export function pickingRowStage(flags: {
  isAssigned: boolean;
  isDone: boolean;
  isChecked: boolean;
}): string {
  if (flags.isChecked) return PICK_CHECKED;
  if (flags.isDone) return PICK_DONE;
  if (flags.isAssigned) return PICK_ASSIGNED;
  return SUPPORT_DONE_OUTPUT;
}
