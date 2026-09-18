// Floor delivery-type scope — the ONE definition, shared by the server queries
// and the client board.
//
// WHY THIS FILE EXISTS. Floor's scope has never been a database filter. It was
// always applied in JS, AFTER the rows were fetched: lib/floor/queries.ts ran
// `if (!inScope(...)) continue;` inside its row-building loops, and not one
// `findMany` referenced scope. Every scope value therefore cost the IDENTICAL
// database work, and `All` is a strict superset of Local / Upcountry / IGT by
// construction.
//
// So the client now fetches ONCE, unscoped, and re-derives each scope's view
// here — running the same predicate the server ran, on the same rows. Clicking
// a scope chip stopped being a refetch (3 routes per click) and became a
// `useMemo`.
//
// This module is CLIENT-SAFE — types only, no prisma, no server imports. That
// is load-bearing: lib/floor/queries.ts imports prisma, so the client can never
// import from it, and a second copy of `inScope` living in the component is
// exactly the drift this file exists to prevent. Keep it dependency-free.

import type { FloorScope, FloorBoardResult } from "./types";

/** Does a row's delivery type belong to this scope? `All` admits everything,
 *  including a null delivery type; a named scope matches by exact string.
 *  Unchanged from the original in lib/floor/queries.ts — moved, not rewritten. */
export function inScope(deliveryType: string | null, scope: FloorScope): boolean {
  return scope === "All" || deliveryType === scope;
}

/** Narrow any list of rows carrying a `deliveryType` to one scope. */
export function rowsInScope<T extends { deliveryType: string | null }>(
  rows: T[],
  scope: FloorScope,
): T[] {
  return scope === "All" ? rows : rows.filter((r) => inScope(r.deliveryType, scope));
}

/** The two fields of a trip summary the trip rules below read. Structural, so
 *  this module stays free of lib/trips/queries.ts (which imports prisma). */
interface TripTypes {
  /** Its stored type UNIONED with its bills' types (lib/trips/queries.ts). The CHIP's list. */
  deliveryTypes: string[];
  /** What the trip was numbered under — the letter. The TAB's answer. */
  deliveryTypeName: string | null;
}

/**
 * Does a trip belong on this tab? By the trip's OWN delivery type — the one it
 * was numbered under, the letter in its number — and nothing else. `All` admits
 * every trip, exactly as `inScope` admits every row. A Cross trip shows under
 * All only, because there is no Cross tab.
 *
 * 🔴 NOT BY ITS BILLS' TYPES (owner, 2026-09-18, reversing 41c5dab8 the same
 * day). The letter is what the planner DECLARED the trip to be. L-260918-03 is
 * a Local trip that happens to carry one Kamrej drop; putting it on the
 * Upcountry tab put a truck in front of the Upcountry planner that is not his.
 * The "Local + Upcountry" chip (`tripMixLabel`) says what is on the truck
 * without moving the truck anywhere — that is the whole of its job.
 *
 * ⚠ THE TRIP PANEL IS A DIFFERENT RULE AND STAYS AS IT IS. An opened trip shows
 * every bill on it whatever tab is selected (floor-page.tsx `unfilteredRows`).
 * This function decides which trips the RAIL lists, never what a trip contains.
 */
export function tripInScope(trip: TripTypes, scope: FloorScope): boolean {
  return inScope(trip.deliveryTypeName, scope);
}

/**
 * The quiet chip's words — "Local + Upcountry", "IGT + Upcountry" — or null when
 * the trip holds one type. Read from `deliveryTypes`, the stored type UNIONED
 * with its bills' types — which is why that union is still built server-side
 * although the tabs no longer read it.
 * Actual type names joined with "+", nothing invented:
 * "Cross" is a real delivery type (delivery_type_master id 6), so a mixed load
 * is never called a "cross" trip.
 */
export function tripMixLabel(trip: Pick<TripTypes, "deliveryTypes">): string | null {
  return trip.deliveryTypes.length > 1 ? trip.deliveryTypes.join(" + ") : null;
}

// `railInScope` LIVED HERE UNTIL 2026-09-13 and went with the rail feed itself
// (app/api/floor/board/route.ts). It was `rowsInScope` under another name, for a
// payload nothing has rendered since 2026-09-10. `rowsInScope` above is the
// general form and takes any shape with a `deliveryType`, so a future rail-like
// list needs no new wrapper.

/**
 * Re-derive a scoped FloorBoardResult from an UNSCOPED one.
 *
 * ⚠ THE DERIVED NUMBERS ARE THE DELICATE PART. `total` and every
 * `windows[].count` are computed by getFloorBoard AFTER its scope filter, from
 * the DUE rows only (`zone !== "upcoming"`) — see the tail of getFloorBoard in
 * lib/floor/queries.ts. This function reproduces that exactly and in the same
 * order: filter by scope → drop `upcoming` → count per window → total.
 *
 * Get that order wrong and the slot-tab counts silently disagree with the rows
 * underneath them, which is precisely the class of bug that survives a green
 * build. scripts/_verify-floor-scope.ts checks this against live data for all
 * four scopes.
 *
 * The window LIST itself is scope-independent (the server maps over every
 * active dispatch_slot_master row regardless of scope, emitting zero counts for
 * empty ones), so only the counts are recomputed — never the set of windows.
 *
 * `waitingSkus` is narrowed for the SAME reason and by the same route: the
 * server builds it from its rows AFTER the scope filter, so a spread that
 * carried the unscoped array through would hand the By-group engine candidates
 * for bills the operator cannot see on the chip he has open. Order is preserved
 * (both this filter and `rowsInScope` are stable), which is what keeps the
 * engine's determinism contract intact across a chip click.
 *
 * `oilSkus` (Rule 2) is narrowed IDENTICALLY, by the same `visible` set and in
 * the same pass — it is a sibling of waitingSkus, not a derivative of it, so it
 * needs its own filter and would otherwise ride through untouched on the
 * spread. When RULE2_ENABLED is false the server ships `[]` and this is a
 * no-op, which is the correct behaviour and not a special case.
 */
export function scopeBoard(board: FloorBoardResult, scope: FloorScope): FloorBoardResult {
  const rows = rowsInScope(board.rows, scope);
  const due = rows.filter((r) => r.zone !== "upcoming");
  const windows = board.windows.map((w) => ({
    ...w,
    count: due.filter((r) => r.windowId === w.id).length,
  }));
  const visible = new Set(rows.map((r) => r.orderId));
  const waitingSkus = board.waitingSkus.filter((w) => visible.has(w.orderId));
  const oilSkus = board.oilSkus.filter((o) => visible.has(o.orderId));
  return { ...board, rows, windows, total: due.length, waitingSkus, oilSkus };
}
