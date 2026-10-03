// lib/picking/direct-load.ts
//
// Direct Loading (2026-10-03, schema v27.52) — the picking supervisor sends a
// bill straight to `pick_checked` with NO picker: it is loaded onto the vehicle
// from stock. Stored as orders.directLoadedAt / directLoadedById beside the
// stage, never as a new workflowStage (every reader of `pick_checked` — billing,
// trips, Floor — then works unchanged) and never on pick_assignments (a bill
// with no picker has no assignment row).
//
// 🔴 NOT orders.loadedAt / loadedById — those are reserved for the future
// Vehicle Loading screen.
//
// PURE (zero imports beyond the stage constants) so a client component can
// import it as well as the two routes:
//   app/api/picking/direct-load/route.ts       — the press (bulk)
//   app/api/picking/direct-load/undo/route.ts  — the undo (one bill)

import { PICK_ASSIGNED, SUPPORT_DONE_OUTPUT } from "@/lib/workflow-stages";

/**
 * The stages a bill may be Direct Loaded FROM. Nobody has picked it yet: it is
 * waiting, or a picker has it but has not marked it done.
 *
 * ⚠ `pick_done` IS REFUSED ON PURPOSE (owner, 2026-10-03): the picker actually
 * picked those goods, so "not picked — load from stock" would be false. That
 * bill goes forward by Approve. Everything later is finished or gone.
 */
export const DIRECT_LOADABLE_STAGES: readonly string[] = [SUPPORT_DONE_OUTPUT, PICK_ASSIGNED];

/** order_status_logs note for the press. */
export const DIRECT_LOAD_NOTE = "Direct loading";
/** order_status_logs note for the undo. */
export const DIRECT_LOAD_UNDO_NOTE = "Direct loading undone";

/** The press's log note, naming the picker when one was taken off the bill. */
export function directLoadNote(removedPickerName: string | null): string {
  return removedPickerName !== null ? `${DIRECT_LOAD_NOTE} · picker removed (${removedPickerName})` : DIRECT_LOAD_NOTE;
}

/**
 * The time a Done-band row was finished: the supervisor's check, or — for a
 * Direct Loaded bill, which has no pick_assignments row and so no checkedAt —
 * the moment it was Direct Loaded. COALESCE(checkedAt, directLoadedAt).
 * Sort the Checked band on THIS, never on checkedAt alone, or every direct-
 * loaded bill sinks to the bottom as if it had no time.
 */
export function doneSortAt(row: {
  checkedAt: Date | string | null;
  directLoadedAt?: Date | string | null;
}): number {
  const t = row.checkedAt ?? row.directLoadedAt ?? null;
  if (t === null) return 0;
  const ms = new Date(t).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}
