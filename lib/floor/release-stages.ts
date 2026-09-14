// Floor Control — the stages a bill may be RELEASED to the floor from.
//
// This is Floor's OWN, explicit rule — deliberately NOT Support's
// supportMayEdit() (lib/workflow-stages.ts). Borrowing that predicate would
// couple Floor's release behaviour to Support's PERMISSION model: a future change
// to what Support may edit (e.g. locking a new mid-pipeline stage) would silently
// move Floor's release gate with it. The two answer different questions —
// "may Support touch this?" vs "can Floor release this to the floor?" — so Floor
// keeps its own list, changed only when a Floor reason changes it.
//
// A held bill reaches the Hold tab with dispatchStatus="hold" at WHATEVER stage it
// was holding at — hold flips the status only, never the workflowStage. So the
// release path must accept every stage a releasable-yet-held bill can legitimately
// sit at, not just the rail's single stage.

export const FLOOR_RELEASABLE_STAGES: string[] = [
  // The classic rail release: a bill still on the left rail, never sent to the
  // floor. Non-tint, or a tint bill whose splits are all done. Releasing writes
  // the slot and advances it to pending_picking.
  "pending_support",

  // A bill that enrichment auto-dispatched to the floor (→ pending_picking), then
  // was HELD from the floor. Hold left the stage at pending_picking and only set
  // dispatchStatus="hold". Releasing it re-affirms the slot and flips
  // dispatchStatus hold→dispatch; the stage write is a no-op (already
  // pending_picking). Without this entry such a bill can never leave Hold — the
  // exact silent-no-op bug this list fixes.
  "pending_picking",
];

// ── CLEAR HOLD (slice 3b, 2026-09-14) ───────────────────────────────────────
//
// The stages a HELD bill may have its hold cleared at: `dispatchStatus`
// hold → dispatch, stage untouched, no slot asked for.
//
// 🔴 EVERY STAGE HERE IS ONE THE BILL REACHED BY BEING SENT TO THE FLOOR. Such a
// bill needs nothing but the hold gone. Before this list existed, the only way
// off Hold was Release, and Release admits only FLOOR_RELEASABLE_STAGES — so a
// bill held at `pick_done` or `pick_checked` could not leave Hold at all (29 of
// them, read 2026-09-14).
//
// 🔴 `pending_support` IS DELIBERATELY ABSENT, AND MUST NEVER BE ADDED. That
// bill has never been sent anywhere; it needs a slot and a stage, which is
// Release. Writing `dispatch` onto it leaves a bill no screen shows — no arm of
// floorBoardWhere (lib/floor/queries.ts) matches `pending_support` + `dispatch`,
// nor the Hold tab, nor the picking queue. That is the one outcome worse than
// being stuck on Hold.
//
// ⚠ WRITTEN OUT, NOT PICKING_ACTIVE_STAGES by import. They are the same four
// today; a stage added to the picking ladder must be a decision to make it
// clearable, never something this list inherits. Pure and import-free so the
// detail panel (client) and the actions route (server) read ONE list.
export const FLOOR_CLEAR_HOLD_STAGES: string[] = [
  "pending_picking",
  "pick_assigned",
  "pick_done",
  "pick_checked",
];
