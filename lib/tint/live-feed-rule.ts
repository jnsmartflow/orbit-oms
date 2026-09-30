// lib/tint/live-feed-rule.ts — the pure half of Tint's live-feed narrowing (tint step 3, 2026-09-30).
// No DB, no Next — unit-tested in lib/tint/live-feed-rule.test.ts. The SQL half is lib/tint/live-feed.ts.
//
// GET /api/live/changes?screen=tint hands a Tint screen only the ORDER ids that can change it:
//   · Manager (no face): ids on the Manager board NOW (a superset of the five sets of
//     app/api/tint/manager/orders, hide rules ignored) ∪ `held` — the ids the board already shows, so a
//     bill LEAVING the board (removed, hidden, bypass undone) still wakes it. Plus `missingTouched`: any
//     changed id whose customerMissing is true now, or that is in `missing` — the ids the side list
//     already shows, so a customer FIX (customerMissing → false) still refreshes the list.
//   · Operator (face=operator): ids in the SESSION user's my-orders set NOW (the four queries of
//     app/api/tint/operator/my-orders, hide ignored) ∪ `held` (his phone's ids).
// The cursor still advances over every row; the filter is for bandwidth and reload count, never a gap.

export interface TintManagerRow {
  id: number;
  /** On (a superset of) the Manager board right now. */
  onBoard: boolean;
  /** orders.customerMissing right now. */
  missing: boolean;
}

export interface TintManagerDecision {
  /** Changed order ids the Manager must see (input order). */
  keep: number[];
  /** The missing-customers side list may have changed. */
  missingTouched: boolean;
}

/** Manager: keep = on board ∪ held; missingTouched = any changed id missing now or already listed. */
export function decideTintManager(
  changedIds: readonly number[],
  rows: readonly TintManagerRow[],
  held: readonly number[],
  missingHeld: readonly number[],
): TintManagerDecision {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const heldSet = new Set(held);
  const missingSet = new Set(missingHeld);
  const keep = changedIds.filter((id) => byId.get(id)?.onBoard === true || heldSet.has(id));
  const missingTouched = changedIds.some((id) => byId.get(id)?.missing === true || missingSet.has(id));
  return { keep, missingTouched };
}

/** Operator: keep = his ids now ∪ held (input order). */
export function decideTintOperator(changedIds: readonly number[], mine: readonly number[], held: readonly number[]): number[] {
  const keep = new Set<number>(mine);
  for (const id of held) keep.add(id);
  return changedIds.filter((id) => keep.has(id));
}

/**
 * "Today" exactly as each route computes it (fix both together or neither — CLAUDE_TINT §1.9 / §3.11):
 *   Manager board + marker: server-LOCAL midnight (UTC on Vercel);
 *   Operator my-orders:     UTC midnight (setUTCHours).
 */
export function managerStartOfToday(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}
export function operatorStartOfToday(now: Date): Date {
  const d = new Date(now.getTime());
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** my-orders' own face branch: operations / admin see every operator's rows (CLAUDE_TINT §13.4). */
export function operatorSeesAll(primaryRole: string | null | undefined): boolean {
  return ["operations", "admin"].includes(primaryRole ?? "");
}
