// lib/floor/live-merge.ts — PURE merge rules for Floor on the live change feed (7b).
//
// Design of record: docs/prompts/drafts/code-discovery-2026-09-29-live-change-feed.md §G
// 7a findings:      docs/prompts/drafts/code-update-2026-09-30-live-feed-7a.md ("For 7b")
// Tests:            lib/floor/live-merge.test.ts
//
// No React, no fetch, no Prisma — client-safe (type-only imports). The patched
// rows come from POST /api/floor/rows, which builds them with the SAME feed
// functions as a full load, so after a merge each list is exactly what a full
// load would return for those ids, re-sorted with the feed's own rule:
//   board     → sortFloorRows (FLOOR_SPINE + keepPairsAdjacent, getFloorBoard)
//   hold      → compareHoldRows      (getFloorHold — shared via lib/floor/sort.ts)
//   cancelled → compareCancelledRows (getFloorCancelled — same)
// Ties among equal sort keys may land in a different order than a full load
// (Array.sort is stable over whatever order the rows are in) — the same as two
// full loads of the same data already can.

import { sortFloorRows, compareCancelledRows, compareHoldRows } from "@/lib/floor/sort";
import type { FloorBoardResult, FloorBoardRow, FloorCancelledRow, FloorHoldRow } from "@/lib/floor/types";
import type { TripSummary } from "@/lib/trips/queries";
// Pure, client-safe — the one "drop self" rule, shared with getFloorBoard.
import { partnersOf, type InvoicePartner } from "@/lib/floor/invoice-pairs";

export type FloorTab = "board" | "hold" | "cancelled";

/** One entry of POST /api/floor/rows. `tab`/`row` null = the bill left Floor. */
export interface FloorRowPatchIn {
  id: number;
  tab: FloorTab | null;
  row: FloorBoardRow | FloorHoldRow | FloorCancelledRow | null;
}

/** The lists a Floor page holds. hold / cancelled are null until that lazy tab is loaded. */
export interface FloorLists {
  board: FloorBoardRow[];
  hold: FloorHoldRow[] | null;
  cancelled: FloorCancelledRow[] | null;
}

export interface FloorMergeResult {
  lists: FloorLists;
  /** Trip numbers the patched bills were on BEFORE the patch (board rows only carry the number). */
  previousTripNumbers: string[];
  /** Every tab a patched bill was on before or is on now. */
  tabsTouched: Set<FloorTab>;
}

/**
 * Apply one POST /api/floor/rows answer.
 *   · every patched id is removed from every list, then placed by its tab;
 *   · a row for a lazy tab that is not loaded (null) is NOT kept — the tab's
 *     count (GET /api/floor/counts) carries it until the tab is opened;
 *   · each list is re-sorted with its feed's own rule;
 *   · soFlags (duplicate-SO answers) are applied to EVERY board row with that
 *     SO, not only the patched ones — a twin's arrival or cancel flips rows that
 *     did not change themselves.
 */
export function mergeFloorRows(
  lists: FloorLists,
  patches: FloorRowPatchIn[],
  soFlags: Record<string, boolean>,
  // Invoice partners (2026-10-08) — POST /api/floor/rows `partnersByInvoice`.
  // Optional: omitted → no partner list changes, as before.
  partnersByInvoice: Record<string, InvoicePartner[]> = {},
): FloorMergeResult {
  const ids = new Set(patches.map((p) => p.id));
  const tabsTouched = new Set<FloorTab>();
  const previousTripNumbers: string[] = [];

  for (const r of lists.board) {
    if (!ids.has(r.orderId)) continue;
    tabsTouched.add("board");
    if (r.tripNumber) previousTripNumbers.push(r.tripNumber);
  }
  if (lists.hold?.some((r) => ids.has(r.orderId))) tabsTouched.add("hold");
  if (lists.cancelled?.some((r) => ids.has(r.orderId))) tabsTouched.add("cancelled");
  for (const p of patches) if (p.tab) tabsTouched.add(p.tab);

  let board = lists.board.filter((r) => !ids.has(r.orderId));
  let hold = lists.hold === null ? null : lists.hold.filter((r) => !ids.has(r.orderId));
  let cancelled = lists.cancelled === null ? null : lists.cancelled.filter((r) => !ids.has(r.orderId));

  for (const p of patches) {
    if (p.tab === "board" && p.row) board.push(p.row as FloorBoardRow);
    else if (p.tab === "hold" && p.row && hold !== null) hold.push(p.row as FloorHoldRow);
    else if (p.tab === "cancelled" && p.row && cancelled !== null) cancelled.push(p.row as FloorCancelledRow);
  }

  board = sortFloorRows(board);
  if (hold !== null) hold = hold.sort(compareHoldRows);
  if (cancelled !== null) cancelled = cancelled.sort(compareCancelledRows);

  board = applySoFlags(board, soFlags);
  board = applyInvoicePartners(board, partnersByInvoice);

  return {
    lists: { board, hold, cancelled },
    previousTripNumbers: Array.from(new Set(previousTripNumbers)),
    tabsTouched,
  };
}

/** Set `hasDuplicateSo` on every board row whose SO has an answer; untouched rows keep their identity. */
export function applySoFlags(board: FloorBoardRow[], soFlags: Record<string, boolean>): FloorBoardRow[] {
  if (Object.keys(soFlags).length === 0) return board;
  return board.map((r) => {
    if (r.soNumber === null || !(r.soNumber in soFlags)) return r;
    const flag = soFlags[r.soNumber];
    return r.hasDuplicateSo === flag ? r : { ...r, hasDuplicateSo: flag };
  });
}

/**
 * Rewrite `invoicePartners` on EVERY board row whose invoice has an answer —
 * the invoice twin of applySoFlags (2026-10-08). A partner that went on hold,
 * was dispatched, removed or hidden changes the OTHER rows on its invoice,
 * which did not change themselves. Each group is the whole invoice (server,
 * lib/floor/rows.ts); the row's own entry is dropped here (`partnersOf`), so
 * any group size works. Rows that come out the same keep their identity.
 */
export function applyInvoicePartners(
  board: FloorBoardRow[],
  partnersByInvoice: Record<string, InvoicePartner[]>,
): FloorBoardRow[] {
  if (Object.keys(partnersByInvoice).length === 0) return board;
  const map = new Map(Object.entries(partnersByInvoice));
  return board.map((r) => {
    if (r.invoiceNo === null || !map.has(r.invoiceNo)) return r;
    const next = partnersOf(map, r.invoiceNo, r.orderId);
    return samePartners(r.invoicePartners ?? [], next) ? r : { ...r, invoicePartners: next };
  });
}

function samePartners(a: InvoicePartner[], b: InvoicePartner[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (p, i) =>
        p.orderId === b[i].orderId &&
        p.obdNumber === b[i].obdNumber &&
        p.workflowStage === b[i].workflowStage &&
        p.place === b[i].place,
    )
  );
}

/**
 * The trips to refresh after a patch: the trips the feed named, the trips the
 * patched bills are on NOW (rows answer `tripIds`), and the trips they were on
 * BEFORE (by trip number, resolved through the loaded trip list).
 */
export function tripIdsToRefresh(
  feedTripIds: number[],
  nowTripIds: number[],
  previousTripNumbers: string[],
  loadedTrips: TripSummary[] | null,
): number[] {
  const out = new Set<number>([...feedTripIds, ...nowTripIds]);
  if (loadedTrips) {
    const byNumber = new Map(loadedTrips.map((t) => [t.tripNumber, t.id]));
    for (const n of previousTripNumbers) {
      const id = byNumber.get(n);
      if (id !== undefined) out.add(id);
    }
  }
  return Array.from(out).sort((a, b) => a - b);
}

/**
 * Board bills whose row shows something OF A TRIP (number, status, the
 * awaiting-show pill) — for trips that changed without any bill changing
 * (show / take back, send to billing, vehicle, rename). Matched by the trip
 * numbers the loaded list knows for those trip ids.
 */
export function boardIdsOnTrips(board: FloorBoardRow[], tripIds: number[], loadedTrips: TripSummary[] | null): number[] {
  if (!loadedTrips || tripIds.length === 0) return [];
  const wanted = new Set(tripIds);
  const numbers = new Set(loadedTrips.filter((t) => wanted.has(t.id)).map((t) => t.tripNumber));
  return board.filter((r) => r.tripNumber !== null && numbers.has(r.tripNumber)).map((r) => r.orderId);
}

/**
 * Apply GET /api/floor/trips?ids= — replace the returned trips, add new ones,
 * drop `gone`, then restore the feed's order (createdAt desc, id desc —
 * lib/trips/queries.ts getTripsForDate).
 */
export function mergeTrips(trips: TripSummary[], fresh: TripSummary[], gone: number[]): TripSummary[] {
  const goneSet = new Set(gone);
  const byId = new Map<number, TripSummary>();
  for (const t of trips) if (!goneSet.has(t.id)) byId.set(t.id, t);
  for (const t of fresh) byId.set(t.id, t);
  return Array.from(byId.values()).sort((a, b) =>
    a.createdAt === b.createdAt ? b.id - a.id : a.createdAt < b.createdAt ? 1 : -1,
  );
}

/** A rows answer for another day than the one on screen → the client must do a full load. */
export function isDateMismatch(loadedDate: string | null | undefined, answeredDate: string): boolean {
  return !!loadedDate && loadedDate !== answeredDate;
}

/**
 * The board result around patched rows: `windows[].count` and `total` recomputed
 * from the rows exactly as the server and `scopeBoard` compute them (due = not
 * zone "upcoming"). `waitingSkus` / `oilSkus` are left as they were — nothing
 * reads them (7a: "dead reads"), and the by-id board does not build them.
 */
export function withBoardRows(floor: FloorBoardResult, rows: FloorBoardRow[]): FloorBoardResult {
  const due = rows.filter((r) => r.zone !== "upcoming");
  const windows = floor.windows.map((w) => ({ ...w, count: due.filter((r) => r.windowId === w.id).length }));
  return { ...floor, rows, windows, total: due.length };
}
