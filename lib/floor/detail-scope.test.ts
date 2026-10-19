// lib/floor/detail-scope.test.ts — npx tsx --test lib/floor/detail-scope.test.ts
//
// Add invoices Phase 4 commit 3: the detail panel scoped to one invoice. Pure.
// Fixture: order 18648 (OBD 9109951956) — 716 (seq 1), 713, 714, 715; one line each.

import test from "node:test";
import assert from "node:assert/strict";
import { activityForInvoice, detailWalk, otherInvoices, resolveScope, scopedHoldBody, scopedInvoiceRowId, scopeItems, walkIndex } from "./detail-scope";

const SPLIT = [
  { seq: 1, invoiceNo: "I536230716" },
  { seq: 2, invoiceNo: "I536230713" },
  { seq: 3, invoiceNo: "I536230714" },
  { seq: 4, invoiceNo: "I536230715" },
];
const ROWS = [
  { orderId: 7, invoiceRows: [] },
  { orderId: 18648, invoiceRows: SPLIT },
  { orderId: 9 },
];

test("walk: board order, a split OBD one key per invoice (716 → 713 → 714 → 715 → next bill)", () => {
  assert.deepEqual(detailWalk(ROWS), [
    { orderId: 7, invoiceSeq: null },
    { orderId: 18648, invoiceSeq: 1 },
    { orderId: 18648, invoiceSeq: 2 },
    { orderId: 18648, invoiceSeq: 3 },
    { orderId: 18648, invoiceSeq: 4 },
    { orderId: 9, invoiceSeq: null },
  ]);
});

test("walk: OBD view (History / Hold / Cancelled) — one key per bill", () => {
  assert.deepEqual(detailWalk(ROWS, false).map((k) => k.invoiceSeq), [null, null, null]);
});

test("scope: kept while the invoice is there; OBD view when it is gone, unsplit, or the source never scopes", () => {
  assert.deepEqual(resolveScope({ orderId: 18648, invoiceSeq: 2 }, SPLIT, true), { orderId: 18648, invoiceSeq: 2 });
  assert.deepEqual(resolveScope({ orderId: 18648, invoiceSeq: 4 }, SPLIT.slice(0, 3), true), { orderId: 18648, invoiceSeq: null });
  assert.deepEqual(resolveScope({ orderId: 18648, invoiceSeq: 2 }, [SPLIT[0]], true), { orderId: 18648, invoiceSeq: null });
  assert.deepEqual(resolveScope({ orderId: 18648, invoiceSeq: 2 }, undefined, true), { orderId: 18648, invoiceSeq: null });
  assert.deepEqual(resolveScope({ orderId: 18648, invoiceSeq: 2 }, SPLIT, false), { orderId: 18648, invoiceSeq: null });
});

test("walk index: exact; an OBD-view key on a split bill lands on its first invoice; absent → -1", () => {
  const list = detailWalk(ROWS);
  assert.equal(walkIndex(list, { orderId: 18648, invoiceSeq: 3 }), 3);
  assert.equal(walkIndex(list, { orderId: 18648, invoiceSeq: null }), 1);
  assert.equal(walkIndex(list, { orderId: 18648, invoiceSeq: 9 }), -1);
  assert.equal(walkIndex(list, { orderId: 5, invoiceSeq: null }), -1);
});

test("other invoices: the rest, seq order, last 3 digits", () => {
  assert.deepEqual(otherInvoices(SPLIT, 2).map((o) => [o.seq, o.label, o.invoiceNo]), [
    [1, "716", "I536230716"],
    [3, "714", "I536230714"],
    [4, "715", "I536230715"],
  ]);
});

test("items: only the invoice's lines, by raw line id, its tins and litres pro rata; a gone line is counted missing", () => {
  const lines = [
    { id: 62850, qty: 13, litres: 260, name: "WS Protect Dustproof" },
    { id: 62851, qty: 12, litres: 240, name: "WS Protect Hi-Sheen" },
    { id: 62853, qty: 15, litres: 300, name: "Aquatech DP" },
  ];
  assert.deepEqual(scopeItems(lines, [{ rawLineItemId: 62850, qty: 13 }]), { lines: [lines[0]], missing: 0 });
  const part = scopeItems(lines, [{ rawLineItemId: 62853, qty: 5 }, { rawLineItemId: 99999, qty: 2 }]);
  assert.deepEqual(part.lines, [{ id: 62853, qty: 5, litres: 100, name: "Aquatech DP" }]);
  assert.equal(part.missing, 1);
});

test("activity: OBD-wide entries on every invoice; an entry naming invoice rows only on those invoices", () => {
  const e = [
    { note: "Picked" },
    { note: "Invoice held from floor · I536230716, I536230714", orderInvoiceIds: [17010, 36799] },
    { note: "Released", orderInvoiceIds: [] },
  ];
  assert.deepEqual(activityForInvoice(e, 17010).map((x) => x.note), ["Picked", "Invoice held from floor · I536230716, I536230714", "Released"]);
  assert.deepEqual(activityForInvoice(e, 36799).map((x) => x.note), ["Picked", "Invoice held from floor · I536230716, I536230714", "Released"]);
  assert.deepEqual(activityForInvoice(e, 36798).map((x) => x.note), ["Picked", "Released"]);
});

test("walk: a NARROWED row walks its drawn invoices only, still per invoice with one drawn (6.1)", () => {
  const all = SPLIT.map((s, i) => ({ ...s, id: i }));
  const held = { orderId: 18648, invoiceRows: [all[2]], invoiceRowsAll: all };
  assert.deepEqual(detailWalk([held]), [{ orderId: 18648, invoiceSeq: 3 }]);
  assert.deepEqual(detailWalk([{ orderId: 18648, invoiceRows: [], invoiceRowsAll: all }]), [{ orderId: 18648, invoiceSeq: null }]);
});

// ── the panel's scoped Hold / Release (6.1 fix) ─────────────────────────────

test("panel scope → action: a scoped invoice of a split OBD acts on that row; otherwise the whole OBD", () => {
  const rows = [
    { id: 17010, seq: 1 },
    { id: 36798, seq: 2 },
    { id: 36799, seq: 3 },
    { id: 36800, seq: 4 },
  ];
  assert.equal(scopedInvoiceRowId(3, rows), 36799);
  assert.equal(scopedInvoiceRowId(null, rows), null); // OBD view
  assert.equal(scopedInvoiceRowId(9, rows), null); // the invoice is gone
  assert.equal(scopedInvoiceRowId(1, [{ id: 500, seq: 1 }]), null); // unsplit
  assert.deepEqual(scopedHoldBody("unhold", 18648, 36799), {
    action: "unhold",
    orderIds: [18648],
    invoiceRowIds: { 18648: [36799] },
  });
});
