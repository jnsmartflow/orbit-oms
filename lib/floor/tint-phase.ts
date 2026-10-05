// lib/floor/tint-phase.ts — where a bill stands with the tint room (2026-10-05).
//
// MOVED UNCHANGED out of lib/floor/queries.ts (Billing Print v2) so the Print
// tab can give a bill the SAME tint phase Floor's StatusPill reads, without a
// second copy of the rule. PURE — no Prisma, no clock. Floor imports it from
// here; its behaviour is byte-identical.
//
// ⚠ The "Base — No Tint" override (a colourWork of "base" carries NO phase) is
// applied by each CALLER, exactly as getFloorBoard does — this function only
// knows orderType and workflowStage.

/**
 * THE TINT ROOM'S OWN STAGES — a NEW named constant, not an edit to a shared
 * array (2026-09-13).
 *
 * ⚠ WRITTEN OUT, NOT DERIVED FROM RANK. Ranks 20-40 happen to be these three
 * today, and a rank filter would silently absorb any future mid-pipeline stage
 * into "this bill is in the tint room" — a claim about paint that a number
 * cannot make. The same argument `TINT_IN_PROGRESS_STAGES` in lib/floor/
 * release.ts makes for its own three names; a fourth here needs a person.
 *
 * ⚠ NOT ADDED TO RAIL_STAGES, PICKING_OPEN_STAGES OR ANY OTHER SHARED ARRAY.
 * Those feed predicates; this feeds a DISPLAY field and nothing else.
 */
const TINT_PENDING_STAGE = "pending_tint_assignment";
const TINT_ASSIGNED_STAGE = "tint_assigned";
const TINT_MIXING_STAGE = "tinting_in_progress";

/**
 * Where a bill stands with the tint room — `null` for every plain order.
 *
 * The full contract is on `FloorBoardRow.tintPhase` (lib/floor/types.ts); this
 * is its ONE implementation, so a second surface cannot invent a fourth answer.
 * "done" is deliberately the FALL-THROUGH for a tint bill: past the three tint
 * stages means the tint room is finished with it, whatever happened next.
 */
export function tintPhaseOf(
  orderType: string,
  workflowStage: string,
): "pending" | "assigned" | "tinting" | "done" | null {
  if (orderType !== "tint") return null;
  if (workflowStage === TINT_PENDING_STAGE) return "pending";
  // ⚠ ASSIGNED AND MIXING ARE SEPARATE ANSWERS (2026-09-14). They shared the
  // "tinting" value until today, which made the board claim work was happening
  // on a bill nobody had touched. One stage, one value, and a stage this
  // function has not been taught about falls to "done" — visibly wrong on a
  // tint bill rather than invisibly folded into a state that looks busy.
  if (workflowStage === TINT_ASSIGNED_STAGE) return "assigned";
  if (workflowStage === TINT_MIXING_STAGE) return "tinting";
  return "done";
}
