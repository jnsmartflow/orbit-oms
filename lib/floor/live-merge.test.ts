// lib/floor/live-merge.test.ts — npx tsx --test lib/floor/live-merge.test.ts (npm run test:floor-live)
//
// The pure Floor merge rules for the live feed (7b): placement by tab, removal
// (tab null), re-sort with each feed's own rule, soFlags spread, invoice-partner spread, trip-id union,
// trip-list merge, date mismatch. No database, no React.

import test from "node:test";
import assert from "node:assert/strict";
import {
  applyInvoicePartners,
  applySoFlags,
  boardIdsOnTrips,
  isDateMismatch,
  mergeFloorRows,
  mergeTrips,
  tripIdsToRefresh,
  type FloorLists,
} from "./live-merge";
import type { FloorBoardRow, FloorCancelledRow, FloorHoldRow } from "./types";
import type { TripSummary } from "@/lib/trips/queries";
import { buildPartnerMap, type InvoicePartner, type InvoicePartnerSource } from "./invoice-pairs";

// Only the fields the merge and the FLOOR_SPINE sort read; the rest is opaque.
function b(orderId: number, over: Partial<FloorBoardRow> = {}): FloorBoardRow {
  return {
    orderId,
    obdNumber: `OBD${String(orderId).padStart(4, "0")}`,
    windowSortOrder: 1,
    deliveryType: "Local",
    isKeyCustomer: false,
    priorityLevel: 3,
    obdDateTime: `2026-09-30T0${orderId % 10}:00:00.000Z`,
    isAssigned: false,
    soNumber: null,
    hasDuplicateSo: false,
    tripNumber: null,
    ...over,
  } as unknown as FloorBoardRow;
}
const h = (orderId: number, heldSince: string | null): FloorHoldRow =>
  ({ orderId, heldSince, soNumber: null } as unknown as FloorHoldRow);
const c = (orderId: number, at: string | null): FloorCancelledRow =>
  ({ orderId, at, soNumber: null } as unknown as FloorCancelledRow);
const t = (id: number, tripNumber: string, createdAt: string): TripSummary =>
  ({ id, tripNumber, createdAt } as unknown as TripSummary);

const ids = (rows: { orderId: number }[] | null) => (rows ? rows.map((r) => r.orderId) : null);

// ── placement / removal ─────────────────────────────────────────────────────
test("a patched row replaces the old one in place of its tab; tab null removes it everywhere", () => {
  const lists: FloorLists = { board: [b(1), b(2), b(3)], hold: [h(10, "2026-09-30T01:00:00Z")], cancelled: [] };
  const r = mergeFloorRows(
    lists,
    [
      { id: 2, tab: "hold", row: h(2, "2026-09-30T05:00:00Z") }, // board → hold
      { id: 3, tab: null, row: null }, // left Floor
      { id: 10, tab: "board", row: b(10, { obdDateTime: "2026-09-30T09:00:00.000Z" } as Partial<FloorBoardRow>) }, // released
    ],
    {},
  );
  assert.deepEqual(ids(r.lists.board), [1, 10]);
  assert.deepEqual(ids(r.lists.hold), [2]);
  assert.deepEqual(ids(r.lists.cancelled), []);
  assert.deepEqual(Array.from(r.tabsTouched).sort(), ["board", "hold"]);
  // inputs untouched
  assert.deepEqual(ids(lists.board), [1, 2, 3]);
  assert.deepEqual(ids(lists.hold), [10]);
});

test("a row for a lazy tab that is not loaded is dropped (the count carries it), and the tab stays unloaded", () => {
  const lists: FloorLists = { board: [b(1), b(2)], hold: null, cancelled: null };
  const r = mergeFloorRows(lists, [{ id: 2, tab: "cancelled", row: c(2, "2026-09-30T03:00:00Z") }], {});
  assert.deepEqual(ids(r.lists.board), [1]);
  assert.equal(r.lists.hold, null);
  assert.equal(r.lists.cancelled, null);
  assert.ok(r.tabsTouched.has("cancelled") && r.tabsTouched.has("board"));
});

test("a patch for an id no list holds, with tab null, is a no-op", () => {
  const lists: FloorLists = { board: [b(1)], hold: [], cancelled: [] };
  const r = mergeFloorRows(lists, [{ id: 99, tab: null, row: null }], {});
  assert.deepEqual(ids(r.lists.board), [1]);
  assert.equal(r.tabsTouched.size, 0);
});

// ── re-sort ─────────────────────────────────────────────────────────────────
test("board is re-sorted by FLOOR_SPINE (window, type, key customer, priority, fifo, obdNumber)", () => {
  const lists: FloorLists = {
    board: [b(1, { windowSortOrder: 1 }), b(2, { windowSortOrder: 2 }), b(3, { windowSortOrder: 3 })],
    hold: null,
    cancelled: null,
  };
  const r = mergeFloorRows(
    lists,
    [
      { id: 3, tab: "board", row: b(3, { windowSortOrder: 1, isKeyCustomer: true }) },
      { id: 4, tab: "board", row: b(4, { windowSortOrder: 2, deliveryType: "Upcountry" }) },
      { id: 5, tab: "board", row: b(5, { windowSortOrder: null as unknown as number }) },
    ],
    {},
  );
  // w1: 3 (key) before 1; w2: 2 (Local) before 4 (Upcountry); null window last.
  assert.deepEqual(ids(r.lists.board), [3, 1, 2, 4, 5]);
});

test("FLOOR_SPINE does NOT sink assigned rows (that is Picking's spine)", () => {
  const r = mergeFloorRows(
    { board: [b(1), b(2)], hold: null, cancelled: null },
    [{ id: 1, tab: "board", row: b(1, { isAssigned: true }) }],
    {},
  );
  assert.deepEqual(ids(r.lists.board), [1, 2]);
});

test("hold re-sorted newest held first, unknown last; cancelled newest first", () => {
  const lists: FloorLists = {
    board: [],
    hold: [h(1, "2026-09-30T02:00:00Z"), h(2, null)],
    cancelled: [c(5, "2026-09-30T02:00:00Z")],
  };
  const r = mergeFloorRows(
    lists,
    [
      { id: 3, tab: "hold", row: h(3, "2026-09-30T04:00:00Z") },
      { id: 4, tab: "hold", row: h(4, "2026-09-30T01:00:00Z") },
      { id: 6, tab: "cancelled", row: c(6, "2026-09-30T06:00:00Z") },
      { id: 7, tab: "cancelled", row: c(7, "2026-09-30T00:30:00Z") },
    ],
    {},
  );
  assert.deepEqual(ids(r.lists.hold), [3, 1, 4, 2]);
  assert.deepEqual(ids(r.lists.cancelled), [6, 5, 7]);
});

// ── soFlags ─────────────────────────────────────────────────────────────────
test("soFlags are applied to EVERY board row with that SO, not only the patched ones", () => {
  const lists: FloorLists = {
    board: [b(1, { soNumber: "SO1", hasDuplicateSo: false }), b(2, { soNumber: "SO2", hasDuplicateSo: true }), b(3)],
    hold: null,
    cancelled: null,
  };
  const r = mergeFloorRows(
    lists,
    [{ id: 4, tab: "board", row: b(4, { soNumber: "SO1", hasDuplicateSo: true }) }],
    { SO1: true, SO2: false },
  );
  const bySo = new Map(r.lists.board.map((x) => [x.orderId, x.hasDuplicateSo]));
  assert.equal(bySo.get(1), true); // twin arrived → flag on a row that did not change
  assert.equal(bySo.get(4), true);
  assert.equal(bySo.get(2), false); // twin left
  assert.equal(bySo.get(3), false);
});

test("applySoFlags keeps the identity of rows it does not change", () => {
  const rows = [b(1, { soNumber: "SO1", hasDuplicateSo: true }), b(2)];
  const out = applySoFlags(rows, { SO1: true });
  assert.equal(out[0], rows[0]);
  assert.equal(out[1], rows[1]);
  assert.equal(applySoFlags(rows, {}), rows);
});

// ── trips ───────────────────────────────────────────────────────────────────
test("previousTripNumbers = the trips the patched board bills were on before; unioned into the refresh set", () => {
  const lists: FloorLists = {
    board: [b(1, { tripNumber: "L-001" }), b(2, { tripNumber: "L-002" }), b(3, { tripNumber: "L-001" })],
    hold: null,
    cancelled: null,
  };
  const r = mergeFloorRows(lists, [{ id: 1, tab: "board", row: b(1, { tripNumber: "L-003" }) }, { id: 3, tab: null, row: null }], {});
  assert.deepEqual(r.previousTripNumbers, ["L-001"]);
  const loaded = [t(11, "L-001", "2026-09-30T01:00:00Z"), t(12, "L-002", "2026-09-30T02:00:00Z"), t(13, "L-003", "2026-09-30T03:00:00Z")];
  assert.deepEqual(tripIdsToRefresh([12], [13], r.previousTripNumbers, loaded), [11, 12, 13]);
  // a previous trip the loaded list does not know is skipped, not guessed
  assert.deepEqual(tripIdsToRefresh([], [], ["X-999"], loaded), []);
  assert.deepEqual(tripIdsToRefresh([5, 5], [5], ["L-001"], null), [5]);
});

test("boardIdsOnTrips finds the board bills whose row shows a changed trip", () => {
  const loaded = [t(11, "L-001", "2026-09-30T01:00:00Z"), t(12, "L-002", "2026-09-30T02:00:00Z")];
  const board = [b(1, { tripNumber: "L-001" }), b(2, { tripNumber: "L-002" }), b(3)];
  assert.deepEqual(boardIdsOnTrips(board, [11], loaded), [1]);
  assert.deepEqual(boardIdsOnTrips(board, [], loaded), []);
  assert.deepEqual(boardIdsOnTrips(board, [11], null), []);
});

test("mergeTrips replaces, adds, drops gone, and restores createdAt desc then id desc", () => {
  const trips = [t(3, "L-003", "2026-09-30T03:00:00Z"), t(2, "L-002", "2026-09-30T02:00:00Z"), t(1, "L-001", "2026-09-30T01:00:00Z")];
  const out = mergeTrips(
    trips,
    [t(2, "L-002-renamed", "2026-09-30T02:00:00Z"), t(5, "L-005", "2026-09-30T02:00:00Z"), t(4, "L-004", "2026-09-30T04:00:00Z")],
    [1],
  );
  assert.deepEqual(out.map((x) => x.id), [4, 3, 5, 2]);
  assert.equal(out.find((x) => x.id === 2)?.tripNumber, "L-002-renamed");
  assert.equal(trips.length, 3); // input untouched
});

// ── date ────────────────────────────────────────────────────────────────────
test("date mismatch only when a day is loaded and the answer is for another day", () => {
  assert.equal(isDateMismatch("2026-09-30", "2026-09-30"), false);
  assert.equal(isDateMismatch("2026-09-30", "2026-10-01"), true);
  assert.equal(isDateMismatch(null, "2026-10-01"), false);
  assert.equal(isDateMismatch(undefined, "2026-10-01"), false);
});

test("withBoardRows recomputes window counts and total (due = not upcoming)", async () => {
  const { withBoardRows } = await import("./live-merge");
  const floor = {
    mode: "live",
    date: "2026-09-30",
    rows: [],
    windows: [
      { id: 1, count: 99 },
      { id: 2, count: 99 },
    ],
    total: 99,
    waitingSkus: [],
    oilSkus: [],
  } as unknown as import("./types").FloorBoardResult;
  const rows = [
    b(1, { windowId: 1, zone: "due" } as Partial<FloorBoardRow>),
    b(2, { windowId: 1, zone: "upcoming" } as Partial<FloorBoardRow>),
    b(3, { windowId: 2, zone: "due" } as Partial<FloorBoardRow>),
  ];
  const out = withBoardRows(floor, rows);
  assert.equal(out.total, 2);
  assert.deepEqual(out.windows.map((w) => w.count), [1, 1]);
  assert.equal(out.rows, rows);
  assert.equal(out.date, "2026-09-30");
});

// ── invoice partners (2026-10-08) ───────────────────────────────────────────
// The server sends each invoice's WHOLE group (lib/floor/rows.ts
// partnersByInvoice, built by buildPartnerMap — the one place rule); the merge
// drops self per row. Groups here go through buildPartnerMap for the same reason.

const src = (id: number, inv: string, over: Partial<InvoicePartnerSource> = {}): InvoicePartnerSource => ({
  id,
  obdNumber: `OBD${String(id).padStart(4, "0")}`,
  invoiceNo: inv,
  workflowStage: "pick_checked",
  dispatchStatus: "dispatch",
  isRemoved: false,
  ...over,
});
const groups = (sources: InvoicePartnerSource[], extraEmpty: string[] = []): Record<string, InvoicePartner[]> => {
  const out: Record<string, InvoicePartner[]> = {};
  for (const [k, v] of Array.from(buildPartnerMap(sources).entries())) out[k] = v;
  for (const k of extraEmpty) out[k] ??= [];
  return out;
};
// A board row on invoice `inv` whose partners are currently the given live ids.
const pb = (orderId: number, inv: string, liveIds: number[]): FloorBoardRow =>
  b(orderId, {
    invoiceNo: inv,
    invoicePartners: liveIds.map((id) => ({ orderId: id, obdNumber: `OBD${String(id).padStart(4, "0")}`, workflowStage: "pick_checked", place: "live" as const })),
  } as Partial<FloorBoardRow>);
const placesOf = (rows: FloorBoardRow[], id: number) =>
  rows.find((r) => r.orderId === id)!.invoicePartners.map((p) => `${p.orderId}:${p.place}`);

test("partner goes on hold → the OTHER row (not patched) shows 'hold'", () => {
  const lists: FloorLists = { board: [pb(1, "I1", [2]), pb(2, "I1", [1])], hold: null, cancelled: null };
  const r = mergeFloorRows(
    lists,
    [{ id: 2, tab: "hold", row: h(2, "2026-10-08T05:00:00Z") }],
    {},
    groups([src(1, "I1"), src(2, "I1", { dispatchStatus: "hold" })]),
  );
  assert.deepEqual(ids(r.lists.board), [1]);
  assert.deepEqual(placesOf(r.lists.board, 1), ["2:hold"]);
});

test("partner dispatched → 'dispatched' (it left the board: tab null)", () => {
  const r = mergeFloorRows(
    { board: [pb(1, "I1", [2]), pb(2, "I1", [1])], hold: null, cancelled: null },
    [{ id: 2, tab: null, row: null }],
    {},
    groups([src(1, "I1"), src(2, "I1", { workflowStage: "dispatched" })]),
  );
  assert.deepEqual(placesOf(r.lists.board, 1), ["2:dispatched"]);
});

test("partner removed → 'removed'", () => {
  const r = mergeFloorRows(
    { board: [pb(1, "I1", [2]), pb(2, "I1", [1])], hold: null, cancelled: null },
    [{ id: 2, tab: null, row: null }],
    {},
    groups([src(1, "I1"), src(2, "I1", { isRemoved: true })]),
  );
  assert.deepEqual(placesOf(r.lists.board, 1), ["2:removed"]);
});

test("partner hidden → dropped from the list (the server's group no longer holds it)", () => {
  // Hidden = left out of the server read (hide rule AND-ed on), so the group is
  // the asking bill alone.
  const r = mergeFloorRows(
    { board: [pb(1, "I1", [2]), pb(2, "I1", [1])], hold: null, cancelled: null },
    [{ id: 2, tab: null, row: null }],
    {},
    groups([src(1, "I1")]),
  );
  assert.deepEqual(placesOf(r.lists.board, 1), []);
});

test("an invoice whose every visible bill is gone arrives as [] and clears the stale list", () => {
  const out = applyInvoicePartners([pb(1, "I1", [2])], groups([], ["I1"]));
  assert.deepEqual(out[0].invoicePartners, []);
});

test("a 3-OBD invoice: one goes on hold → both other rows update, self excluded, no size assumed", () => {
  const board = [pb(1, "I3", [2, 3]), pb(2, "I3", [1, 3]), pb(3, "I3", [1, 2])];
  const r = mergeFloorRows(
    { board, hold: null, cancelled: null },
    [{ id: 3, tab: "hold", row: h(3, "2026-10-08T05:00:00Z") }],
    {},
    groups([src(1, "I3"), src(2, "I3"), src(3, "I3", { dispatchStatus: "hold" })]),
  );
  assert.deepEqual(placesOf(r.lists.board, 1), ["2:live", "3:hold"]);
  assert.deepEqual(placesOf(r.lists.board, 2), ["1:live", "3:hold"]);
});

test("applyInvoicePartners keeps identity for unchanged rows and rows on other invoices; {} is a no-op", () => {
  const rows = [pb(1, "I1", [2]), pb(5, "I9", [6]), b(7, { invoiceNo: null, invoicePartners: [] } as Partial<FloorBoardRow>)];
  const out = applyInvoicePartners(rows, groups([src(1, "I1"), src(2, "I1")]));
  assert.equal(out[0], rows[0]); // same answer → same object
  assert.equal(out[1], rows[1]); // invoice not in the answer
  assert.equal(out[2], rows[2]); // no invoice
  assert.equal(applyInvoicePartners(rows, {}), rows);
});
