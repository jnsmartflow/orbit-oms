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

import type { FloorScope, FloorBoardResult, FloorRailCard } from "./types";

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

/** Narrow the rail to one scope. Same predicate, named separately only so call
 *  sites read clearly — the rail is a different shape but scopes identically. */
export function railInScope(cards: FloorRailCard[], scope: FloorScope): FloorRailCard[] {
  return rowsInScope(cards, scope);
}

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
  return { ...board, rows, windows, total: due.length, waitingSkus };
}
