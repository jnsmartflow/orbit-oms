// lib/floor/invoice-rows.test.ts — npx tsx --test lib/floor/invoice-rows.test.ts
//
// Add invoices Phase 4 commit 1: one Floor row per invoice. Pure — no database.
// Fixture: order 18648 / OBD 9109951956 as it is live (4 lines, 50 tins,
// 1,000 L, header 1,357 kg, no line kg) and its 4 invoices 716/713/714/715.

import test from "node:test";
import assert from "node:assert/strict";
import { addedInvoiceNosOf, articleShareText, awayChipOf, buildInvoiceRows, drawRows, drawRowsOf, goneChipOf, hasLoadGroup, loadPlaceArticles, loadRowArticles, loadRowArticleTags, loadTripsOf, narrowToInvoiceIds, narrowToPlace, paperCountOf, placeLoad, type FloorInvoiceRow, type InvoiceLineFacts, type InvoiceRowSource } from "./invoice-rows";

const LINES: InvoiceLineFacts[] = [
  { rawLineItemId: 62850, lineId: 1, skuCodeRaw: "5880380", unitQty: 13, volumeLine: 260, totalWeight: null },
  { rawLineItemId: 62851, lineId: 2, skuCodeRaw: "5963121", unitQty: 12, volumeLine: 240, totalWeight: null },
  { rawLineItemId: 62852, lineId: 3, skuCodeRaw: "9296830", unitQty: 10, volumeLine: 200, totalWeight: null },
  { rawLineItemId: 62853, lineId: 4, skuCodeRaw: "9296830", unitQty: 15, volumeLine: 300, totalWeight: null },
];
const D = new Date("2026-10-05T00:00:00.000Z");
const ROWS: InvoiceRowSource[] = [
  { id: 17010, seq: 1, invoiceNo: "I536230716", invoiceDate: D, lines: [{ rawLineItemId: 62853, qty: 15 }] },
  { id: 17011, seq: 2, invoiceNo: "I536230713", invoiceDate: D, lines: [{ rawLineItemId: 62850, qty: 13 }] },
  { id: 17012, seq: 3, invoiceNo: "I536230714", invoiceDate: D, lines: [{ rawLineItemId: 62851, qty: 12 }] },
  { id: 17013, seq: 4, invoiceNo: "I536230715", invoiceDate: D, lines: [{ rawLineItemId: 62852, qty: 10 }] },
];

test("unsplit (one row) → [] — drawn exactly as before", () => {
  assert.deepEqual(buildInvoiceRows({ rows: [ROWS[0]], activeLines: LINES, obdKg: 1357 }), []);
});

test("18648: tins, litres, ~kg shared by litres (no line kg) — approximate", () => {
  const out = buildInvoiceRows({ rows: ROWS, activeLines: LINES, obdKg: 1357 });
  assert.deepEqual(out.map((r) => [r.seq, r.invoiceNo, r.tins, r.litres]), [
    [1, "I536230716", 15, 300],
    [2, "I536230713", 13, 260],
    [3, "I536230714", 12, 240],
    [4, "I536230715", 10, 200],
  ]);
  // 1,357 kg × litres / 1,000 L.
  [407.1, 352.82, 325.68, 271.4].forEach((x, i) => assert.ok(Math.abs((out[i].kg ?? 0) - x) < 1e-9, `seq ${i + 1}: ${out[i].kg}`));
  assert.ok(out.every((r) => r.kgExact === false && r.stale === false));
  assert.equal(Math.round(out.reduce((s, r) => s + (r.kg ?? 0), 0)), 1357);
  assert.equal(out[0].invoiceDate, "2026-10-05T00:00:00.000Z");
});

test("kg rule 1: line kg on EVERY line of the invoice → exact, pro rata by tins", () => {
  const withKg = LINES.map((l) => (l.rawLineItemId === 62853 ? { ...l, totalWeight: 390 } : l));
  const out = buildInvoiceRows({ rows: ROWS, activeLines: withKg, obdKg: 1357 });
  assert.deepEqual([out[0].kg, out[0].kgExact], [390, true]);
  // The other invoices' lines carry no kg → rule 3.
  assert.equal(out[1].kgExact, false);
  const part = buildInvoiceRows({
    rows: [ROWS[0], { ...ROWS[1], lines: [{ rawLineItemId: 62853, qty: 5 }] }],
    activeLines: withKg,
    obdKg: 1357,
  });
  assert.deepEqual([part[1].kg, part[1].kgExact], [130, true]);
});

test("kg rule 2: a unit weight for every line's SKU → exact; one missing → rule 3", () => {
  const unit = new Map([["5880380", 26], ["5963121", 25]]);
  const out = buildInvoiceRows({ rows: ROWS, activeLines: LINES, obdKg: 1357, unitKgBySku: unit });
  assert.deepEqual([out[1].kg, out[1].kgExact], [13 * 26, true]);
  assert.deepEqual([out[2].kg, out[2].kgExact], [12 * 25, true]);
  assert.equal(out[3].kgExact, false); // 9296830 has no unit weight
});

test("kg rule 2 with SAP's learned kg per tin (live medians, 2026-10-13): 18648's invoices are EXACT and add up", () => {
  const learned = new Map([["5880380", 27.41], ["5963121", 27.111], ["9296830", 27.03]]);
  const out = buildInvoiceRows({ rows: ROWS, activeLines: LINES, obdKg: 1357, unitKgBySku: learned });
  const kg = out.map((r) => Math.round((r.kg ?? 0) * 1000) / 1000);
  assert.deepEqual(kg, [405.45, 356.33, 325.332, 270.3]);
  assert.ok(out.every((r) => r.kgExact));
  // SAP's header 1,357 kg is the line sum cut to a whole number (1,357.412).
  assert.equal(Math.trunc(out.reduce((s, r) => s + (r.kg ?? 0), 0)), 1357);
});

test("kg rule 3 with no header kg → null", () => {
  const out = buildInvoiceRows({ rows: ROWS, activeLines: LINES, obdKg: null });
  assert.ok(out.every((r) => r.kg === null && !r.kgExact));
});

test("stale: a saved line SAP removed, tins that no longer add up, or a half-written row", () => {
  const removed = buildInvoiceRows({ rows: ROWS, activeLines: LINES.slice(0, 3), obdKg: 1357 });
  assert.ok(removed.every((r) => r.stale));
  assert.equal(removed[0].litres, 0); // its only line is gone
  const moved = buildInvoiceRows({ rows: ROWS, activeLines: LINES.map((l) => (l.lineId === 1 ? { ...l, unitQty: 14 } : l)), obdKg: 1357 });
  assert.ok(moved.every((r) => r.stale));
  const half = buildInvoiceRows({ rows: [...ROWS.slice(0, 3), { ...ROWS[3], lines: [] }], activeLines: LINES, obdKg: 1357 });
  assert.ok(half.every((r) => r.stale));
});

test("seq order whatever order the read returns", () => {
  const out = buildInvoiceRows({ rows: ROWS.slice().reverse(), activeLines: LINES, obdKg: 1357 });
  assert.deepEqual(out.map((r) => r.seq), [1, 2, 3, 4]);
  assert.deepEqual(addedInvoiceNosOf(out), ["I536230713", "I536230714", "I536230715"]);
});

test("draw rows: split → one per invoice, key inv:<id>, k of n; unsplit and re-delivery → once", () => {
  const invoiceRows = buildInvoiceRows({ rows: ROWS, activeLines: LINES, obdKg: 1357 });
  const split = drawRowsOf({ orderId: 18648, invoiceRows });
  assert.deepEqual(split.map((d) => [d.key, d.k, d.n, d.first, d.last]), [
    ["inv:17010", 1, 4, true, false],
    ["inv:17011", 2, 4, false, false],
    ["inv:17012", 3, 4, false, false],
    ["inv:17013", 4, 4, false, true],
  ]);
  assert.equal(split[1].invoice?.invoiceNo, "I536230713");
  assert.deepEqual(drawRowsOf({ orderId: 7, invoiceRows: [] }).map((d) => [d.key, d.invoice, d.k, d.n]), [["7", null, 1, 1]]);
  assert.deepEqual(drawRowsOf({ orderId: 18648, invoiceRows, redelivery: { id: 28 } }).map((d) => d.key), ["rd:28"]);
  assert.deepEqual(
    drawRows([{ orderId: 1, invoiceRows: [] }, { orderId: 18648, invoiceRows }, { orderId: 2 }]).map((d) => d.key),
    ["1", "inv:17010", "inv:17011", "inv:17012", "inv:17013", "2"],
  );
});

// ── Phase 5 commit 1: the load of the invoices in one place ──────────────────
const LEARNED = new Map([["5880380", 27.41], ["5963121", 27.111], ["9296830", 27.03]]);
const STOP = 2763;
const ON_STOP = ROWS.map((r) => ({ ...r, tripDropId: r.seq === 2 || r.seq === 4 ? STOP : null, tripNumber: r.seq === 2 || r.seq === 4 ? "L-261007-20" : null }));

test("rows carry their own stop and trip", () => {
  const out = buildInvoiceRows({ rows: ON_STOP, activeLines: LINES, obdKg: 1357, unitKgBySku: LEARNED });
  assert.deepEqual(out.map((r) => [r.seq, r.tripDropId, r.tripNumber, r.tripStatus]), [
    [1, null, null, null],
    [2, STOP, "L-261007-20", null],
    [3, null, null, null],
    [4, STOP, "L-261007-20", null],
  ]);
});

test("placeLoad: 713 + 715 on one stop → 460 L, 356.33 + 270.30 kg, exact, 2 invoices, 23 tins", () => {
  const rows = buildInvoiceRows({ rows: ON_STOP, activeLines: LINES, obdKg: 1357, unitKgBySku: LEARNED });
  const on = placeLoad(rows, (d) => d === STOP)!;
  assert.equal(on.litres, 460);
  assert.ok(Math.abs((on.kg ?? 0) - (356.33 + 270.3)) < 1e-9);
  assert.deepEqual([on.kgExact, on.invoices, on.tins], [true, 2, 23]);
  const off = placeLoad(rows, (d) => d === null)!;
  assert.deepEqual([off.litres, off.invoices, off.tins], [540, 2, 27]);
});

test("placeLoad: null (use the OBD's own totals) when unsplit or WHOLLY in the place; unknown kg stays unknown", () => {
  const rows = buildInvoiceRows({ rows: ROWS, activeLines: LINES, obdKg: 1357 });
  assert.equal(placeLoad(rows, (d) => d === null), null);
  assert.equal(placeLoad(rows.slice(0, 1), (d) => d === null), null);
  const noKg = buildInvoiceRows({ rows: ON_STOP, activeLines: LINES, obdKg: null });
  assert.equal(placeLoad(noKg, (d) => d === STOP)!.kg, null);
  assert.deepEqual(placeLoad(noKg, (d) => d === 1), { litres: 0, kg: 0, kgExact: true, tins: 0, invoices: 0 });
});

test("narrowToPlace: the same object when wholly in the place; else only its invoices, with their litres / kg", () => {
  const whole = { orderId: 18648, volumeLitres: 1000, weightKg: 1357, invoiceRows: buildInvoiceRows({ rows: ROWS, activeLines: LINES, obdKg: 1357 }) };
  assert.equal(narrowToPlace(whole, (d) => d === null), whole);
  const split = { ...whole, invoiceRows: buildInvoiceRows({ rows: ON_STOP, activeLines: LINES, obdKg: 1357, unitKgBySku: LEARNED }) };
  const pool = narrowToPlace(split, (d) => d === null);
  assert.deepEqual(pool.invoiceRows.map((r) => r.seq), [1, 3]);
  assert.equal(pool.volumeLitres, 540);
  assert.ok(Math.abs((pool.weightKg ?? 0) - (405.45 + 325.332)) < 1e-9);
});

// ── P5-3: per-invoice ticks — OBD-wide k/n, ticked load, where the rest are ──

const short = (t: string) => t.replace(/^([A-Z])-\d{6}-(\d+)$/, "$1-$2");

test("drawRowsOf on a NARROWED row: only its invoices, k/n OBD-wide; one left still draws as an invoice", () => {
  const split = { orderId: 18648, volumeLitres: 1000, weightKg: 1357, invoiceRows: buildInvoiceRows({ rows: ON_STOP, activeLines: LINES, obdKg: 1357 }) };
  const pool = narrowToPlace(split, (d) => d === null);
  assert.deepEqual(drawRowsOf(pool).map((d) => [d.key, d.k, d.n, d.first, d.last]), [
    ["inv:17010", 1, 4, true, false],
    ["inv:17012", 3, 4, false, true],
  ]);
  const trip = narrowToPlace(split, (d) => d === STOP);
  assert.deepEqual(drawRowsOf(trip).map((d) => [d.key, d.k, d.n]), [["inv:17011", 2, 4], ["inv:17013", 4, 4]]);
  // One invoice left in a place → an invoice draw "4/4", never a plain OBD row.
  const one = narrowToInvoiceIds(split, [17013]);
  assert.deepEqual(drawRowsOf(one).map((d) => [d.key, d.invoice?.id, d.k, d.n]), [["inv:17013", 17013, 4, 4]]);
});

test("narrowToInvoiceIds: null / every id → the same row; some → their litres and invoiceRowsAll kept", () => {
  const whole: { orderId: number; volumeLitres: number; weightKg: number; invoiceRows: FloorInvoiceRow[]; invoiceRowsAll?: FloorInvoiceRow[] } =
    { orderId: 18648, volumeLitres: 1000, weightKg: 1357, invoiceRows: buildInvoiceRows({ rows: ROWS, activeLines: LINES, obdKg: 1357 }) };
  assert.equal(narrowToInvoiceIds(whole, null), whole);
  assert.equal(narrowToInvoiceIds(whole, [17010, 17011, 17012, 17013]), whole);
  const two = narrowToInvoiceIds(whole, [17011, 17013]);
  assert.deepEqual(two.invoiceRows.map((r) => r.seq), [2, 4]);
  assert.equal(two.invoiceRowsAll?.length, 4);
  assert.equal(two.volumeLitres, 460);
});

test("awayChipOf: all in one place → null; split → '2 on L-20' in To plan, '2 in To plan' on the trip", () => {
  const all = buildInvoiceRows({ rows: ON_STOP, activeLines: LINES, obdKg: 1357 });
  const whole = buildInvoiceRows({ rows: ROWS, activeLines: LINES, obdKg: 1357 });
  assert.equal(awayChipOf(whole, whole, short), null);
  const inPool = all.filter((r) => r.tripDropId === null);
  assert.deepEqual(awayChipOf(all, inPool, short), {
    text: "2 on L-20",
    title: "2 of 4 invoices on L-261007-20 — not shown here",
  });
  assert.equal(awayChipOf(all, all.filter((r) => r.tripDropId === STOP), short)?.text, "2 in To plan");
  // On two trips and To plan: each place named.
  const three = all.map((r) => (r.seq === 3 ? { ...r, tripDropId: 99, tripNumber: "L-261007-05" } : r));
  assert.equal(awayChipOf(three, three.filter((r) => r.tripDropId === STOP), short)?.text, "1 in To plan · 1 on L-05");
});

// ── Split load (phase 3 commit 1, 2026-10-24): parts are rows, not papers ───

/** 18648 as a pure SPLIT LOAD: seq 1 (…716) keeps 25 tins, part 40001 takes 25. */
const LOAD: InvoiceRowSource[] = [
  { id: 17010, seq: 1, invoiceNo: "I536230716", invoiceDate: D, lines: [{ rawLineItemId: 62850, qty: 13 }, { rawLineItemId: 62851, qty: 12 }] },
  { id: 40001, seq: 2, invoiceNo: "I536230716", invoiceDate: D, loadParentId: 17010, lines: [{ rawLineItemId: 62852, qty: 10 }, { rawLineItemId: 62853, qty: 15 }] },
];
/** Add invoices AND a split load: …716 (SAP) split into 2 trucks, …713 typed. */
const MIXED: InvoiceRowSource[] = [
  { id: 17010, seq: 1, invoiceNo: "I536230716", invoiceDate: D, lines: [{ rawLineItemId: 62850, qty: 13 }] },
  { id: 17011, seq: 2, invoiceNo: "I536230713", invoiceDate: D, lines: [{ rawLineItemId: 62851, qty: 12 }] },
  { id: 40001, seq: 3, invoiceNo: "I536230716", invoiceDate: D, loadParentId: 17010, lines: [{ rawLineItemId: 62852, qty: 10 }, { rawLineItemId: 62853, qty: 15 }] },
];

test("split load: loadRootId / halfWritten are ABSENT on every bill without a load row — the payload keeps its keys", () => {
  const plain = buildInvoiceRows({ rows: ROWS, activeLines: LINES, obdKg: 1357 });
  assert.ok(plain.every((r) => !("loadRootId" in r) && !("halfWritten" in r)));
  // An Add invoices half-write stays plain stale, no halfWritten flag.
  const half = buildInvoiceRows({ rows: [...ROWS.slice(0, 3), { ...ROWS[3], lines: [] }], activeLines: LINES, obdKg: 1357 });
  assert.ok(half.every((r) => r.stale && !("halfWritten" in r)));
  const load = buildInvoiceRows({ rows: LOAD, activeLines: LINES, obdKg: 1357 });
  assert.deepEqual(load.map((r) => r.loadRootId), [17010, 17010]);
  const dead = buildInvoiceRows({ rows: [LOAD[0], { ...LOAD[1], lines: [] }], activeLines: LINES, obdKg: 1357 });
  assert.ok(dead.every((r) => r.halfWritten === true && r.stale));
});

test("drawRowsOf: on a bill WITHOUT a load row, chip === { k, n } and load is null on every row (unchanged drawing)", () => {
  const invoiceRows = buildInvoiceRows({ rows: ROWS, activeLines: LINES, obdKg: 1357 });
  for (const d of drawRowsOf({ orderId: 18648, invoiceRows })) {
    assert.deepEqual(d.chip, { k: d.k, n: d.n });
    assert.equal(d.load, null);
  }
  const unsplit = drawRowsOf({ orderId: 7, invoiceRows: [] })[0];
  assert.deepEqual([unsplit.chip, unsplit.load], [null, null]);
});

test("drawRowsOf: a pure split load is ONE paper — no '1/1' chip, 'part 1 of 2' / 'part 2 of 2'", () => {
  const invoiceRows = buildInvoiceRows({ rows: LOAD, activeLines: LINES, obdKg: 1357 });
  assert.deepEqual(drawRowsOf({ orderId: 18648, invoiceRows }).map((d) => [d.key, d.k, d.n, d.chip, d.load]), [
    ["inv:17010", 1, 2, null, { k: 1, n: 2 }],
    ["inv:40001", 2, 2, null, { k: 2, n: 2 }],
  ]);
});

test("drawRowsOf: Add invoices + split load — the Add-invoices k/n counts PAPERS, parts drawn under their paper", () => {
  const invoiceRows = buildInvoiceRows({ rows: MIXED, activeLines: LINES, obdKg: 1357 });
  assert.deepEqual(drawRowsOf({ orderId: 18648, invoiceRows }).map((d) => [d.key, d.chip, d.load, d.first, d.last]), [
    ["inv:17010", { k: 1, n: 2 }, { k: 1, n: 2 }, true, false],
    ["inv:40001", { k: 1, n: 2 }, { k: 2, n: 2 }, false, false],
    ["inv:17011", { k: 2, n: 2 }, null, false, true],
  ]);
  // Narrowed to To plan with part 2 on a trip: only what is here, same labels.
  const pool = { orderId: 18648, volumeLitres: 1000, weightKg: 1357, invoiceRows: invoiceRows.filter((r) => r.id !== 40001), invoiceRowsAll: invoiceRows };
  assert.deepEqual(drawRowsOf(pool).map((d) => [d.key, d.chip, d.load]), [
    ["inv:17010", { k: 1, n: 2 }, { k: 1, n: 2 }],
    ["inv:17011", { k: 2, n: 2 }, null],
  ]);
});

test("paperCountOf / addedInvoiceNosOf: a part is not a paper", () => {
  const plain = buildInvoiceRows({ rows: ROWS, activeLines: LINES, obdKg: 1357 });
  assert.equal(paperCountOf(plain), 4);
  const load = buildInvoiceRows({ rows: LOAD, activeLines: LINES, obdKg: 1357 });
  assert.equal(paperCountOf(load), 1);
  assert.deepEqual(addedInvoiceNosOf(load), []);
  const mixed = buildInvoiceRows({ rows: MIXED, activeLines: LINES, obdKg: 1357 });
  assert.equal(paperCountOf(mixed), 2);
  assert.deepEqual(addedInvoiceNosOf(mixed), ["I536230713"]);
});

test("goneChipOf: a WAITING part whose sibling is dispatched → amber 'part 1 gone'; else null", () => {
  const rows = buildInvoiceRows({
    rows: [{ ...LOAD[0], tripDropId: 2763, tripNumber: "L-261024-04", isDispatched: true }, LOAD[1]],
    activeLines: LINES,
    obdKg: 1357,
  });
  assert.deepEqual(goneChipOf(rows, rows[1]), { text: "part 1 gone", title: "part 1 of I536230716 left on L-261024-04" });
  assert.equal(goneChipOf(rows, rows[0]), null); // the dispatched one itself
  const waiting = buildInvoiceRows({ rows: LOAD, activeLines: LINES, obdKg: 1357 });
  assert.equal(goneChipOf(waiting, waiting[1]), null);
  const plain = buildInvoiceRows({ rows: ROWS, activeLines: LINES, obdKg: 1357 });
  assert.equal(goneChipOf(plain, plain[1]), null);
});

test("awayChipOf: a pure split load says 'parts' in its title; Add invoices keeps 'invoices'", () => {
  const rows = buildInvoiceRows({ rows: [{ ...LOAD[0], tripDropId: STOP, tripNumber: "L-261007-20" }, LOAD[1]], activeLines: LINES, obdKg: 1357 });
  assert.deepEqual(awayChipOf(rows, rows.filter((r) => r.tripDropId === null), short), {
    text: "1 on L-20",
    title: "1 of 2 parts on L-261007-20 — not shown here",
  });
});

// ── Split load, Phase 4 batch 1 (2026-10-25): SAP's articles per truck part ──
//
// Live case I536233980 (order 22179, OBD 9110345576): one line, raw line 74260,
// 70 tins, SAP article 70 ("70 Drum"), totalArticle 70; part 1 (row 40777) and
// part 2 (row 41213) carry 35 tins each.

const I233980_LINES = [{ rawLineItemId: 74260, unitQty: 70, article: 70 }];
const I233980_ROWS = [
  { id: 40777, seq: 1, lines: [{ rawLineItemId: 74260, qty: 35 }] },
  { id: 41213, seq: 2, lines: [{ rawLineItemId: 74260, qty: 35 }] },
];

test("loadRowArticles: I536233980 — 35 / 35, whole, adds up to the bill's 70", () => {
  const a = loadRowArticles({ rows: I233980_ROWS, activeLines: I233980_LINES, totalArticle: 70 });
  assert.deepEqual(Array.from(a.entries()), [[40777, 35], [41213, 35]]);
  assert.equal(loadPlaceArticles(a, [40777]), 35);
  assert.equal(loadPlaceArticles(a, [41213]), 35);
  assert.equal(articleShareText(loadPlaceArticles(a, [40777])), "35");
});

test("loadRowArticles: cartons — articles are packages, not tins (line by line)", () => {
  // 1 L tins, 6 to a carton: 60 tins = 10 cartons; a second line, 4 drums.
  const lines = [{ rawLineItemId: 1, unitQty: 60, article: 10 }, { rawLineItemId: 2, unitQty: 4, article: 4 }];
  const rows = [
    { id: 10, seq: 1, lines: [{ rawLineItemId: 1, qty: 30 }, { rawLineItemId: 2, qty: 4 }] },
    { id: 11, seq: 2, lines: [{ rawLineItemId: 1, qty: 30 }] },
  ];
  const a = loadRowArticles({ rows, activeLines: lines, totalArticle: 14 });
  assert.deepEqual(Array.from(a.entries()), [[10, 9], [11, 5]]); // 5 cartons + 4 drums · 5 cartons — never 34 / 30 tins
});

test("loadRowArticles: not whole → one decimal, '~' when shown; the remainder goes to the LAST part", () => {
  // 7 cartons (42 tins at 6) over 3 trucks of 14 tins → 2.333… each.
  const lines = [{ rawLineItemId: 1, unitQty: 42, article: 7 }];
  const rows = [3, 1, 2].map((seq) => ({ id: 100 + seq, seq, lines: [{ rawLineItemId: 1, qty: 14 }] }));
  const a = loadRowArticles({ rows, activeLines: lines, totalArticle: 7 });
  assert.deepEqual(Array.from(a.entries()), [[101, 2.3], [102, 2.3], [103, 2.4]]); // seq order; seq 3 takes the remainder
  assert.equal(articleShareText(a.get(101)!), "~2");
  assert.equal(articleShareText(a.get(103)!), "~2");
  assert.equal(articleShareText(null), "—");
});

test("loadRowArticles: the parts ALWAYS add up to the bill's totalArticle", () => {
  for (const [total, tins] of [[70, [35, 35]], [7, [14, 14, 14]], [10, [1, 2, 3, 4]], [13, [5, 7]], [1, [1, 1, 1]], [0, [3, 4]]] as const) {
    const qty = tins.reduce((s, t) => s + t, 0);
    const rows = tins.map((t, i) => ({ id: i + 1, seq: i + 1, lines: [{ rawLineItemId: 9, qty: t }] }));
    const a = loadRowArticles({ rows, activeLines: [{ rawLineItemId: 9, unitQty: qty, article: total }], totalArticle: total });
    assert.equal(loadPlaceArticles(a, rows.map((r) => r.id)), total, `total ${total} over ${tins.join("/")}`);
  }
});

test("loadRowArticles: SAP's total wins over Σ line articles (duplicate-SKU cartons); by tins when a line has none", () => {
  // Two lines of one SKU, 1 + 5 tins at 6 a carton: lines say 1 + 5, SAP's total says 1 carton.
  const dup = [{ rawLineItemId: 1, unitQty: 1, article: 1 }, { rawLineItemId: 2, unitQty: 5, article: 5 }];
  const rows = [
    { id: 1, seq: 1, lines: [{ rawLineItemId: 1, qty: 1 }, { rawLineItemId: 2, qty: 2 }] },
    { id: 2, seq: 2, lines: [{ rawLineItemId: 2, qty: 3 }] },
  ];
  assert.deepEqual(Array.from(loadRowArticles({ rows, activeLines: dup, totalArticle: 1 }).entries()), [[1, 0.5], [2, 0.5]]);
  // A line with no article → the share follows tins.
  const none = [{ rawLineItemId: 1, unitQty: 1, article: null }, { rawLineItemId: 2, unitQty: 5, article: 5 }];
  assert.deepEqual(Array.from(loadRowArticles({ rows, activeLines: none, totalArticle: 4 }).entries()), [[1, 2], [2, 2]]);
  // No SAP total → nothing to share (the bill's own blank stays).
  assert.equal(loadRowArticles({ rows, activeLines: dup, totalArticle: null }).size, 0);
  assert.equal(loadPlaceArticles(new Map(), [1]), null);
});

test("hasLoadGroup / loadTripsOf: false for unsplit and 18648; I536233980 → one entry per trip", () => {
  assert.equal(hasLoadGroup(undefined), false);
  assert.equal(hasLoadGroup(buildInvoiceRows({ rows: ROWS, activeLines: LINES, obdKg: 1357 })), false);
  assert.equal(hasLoadGroup(buildInvoiceRows({ rows: LOAD, activeLines: LINES, obdKg: 1357 })), true);
  const rows = [
    { id: 41213, seq: 2, tripDropId: 5816 },
    { id: 40777, seq: 1, tripDropId: 5815 },
  ];
  const trip = new Map([[5815, 1295], [5816, 1296]]);
  assert.deepEqual(loadTripsOf(rows, (d) => trip.get(d)), [
    { tripId: 1295, dropId: 5815, rowIds: [40777] },
    { tripId: 1296, dropId: 5816, rowIds: [41213] },
  ]);
  // A part on a trip outside the report (or on no trip) gives no entry.
  assert.deepEqual(loadTripsOf([...rows, { id: 5, seq: 3, tripDropId: null }], (d) => (d === 5815 ? 1295 : undefined)), [
    { tripId: 1295, dropId: 5815, rowIds: [40777] },
  ]);
});

// ── Phase 4 batch 2: the Floor ARTICLE / ARTICLE TAG cells of a truck part ──

test("loadRowArticleTags: I536233980 — '70 Drum' over 35 / 35 tins → '35 D' on each part", () => {
  const lines = [{ rawLineItemId: 74260, unitQty: 70, articleTag: "70 Drum" }];
  const t = loadRowArticleTags({ rows: I233980_ROWS, activeLines: lines, obdTag: "70 Drum" });
  assert.deepEqual(Array.from(t.entries()), [[40777, "35 D"], [41213, "35 D"]]);
});

test("loadRowArticleTags: each pack type shared line by line; '~' when not whole, remainder to the last part", () => {
  // Line 1: 60 tins = 10 cartons; line 2: 4 drums. Part 1 takes 30 tins + all drums, part 2 the other 30 tins.
  const lines = [{ rawLineItemId: 1, unitQty: 60, articleTag: "10 Carton" }, { rawLineItemId: 2, unitQty: 4, articleTag: "4 Drum" }];
  const rows = [
    { id: 10, seq: 1, lines: [{ rawLineItemId: 1, qty: 30 }, { rawLineItemId: 2, qty: 4 }] },
    { id: 11, seq: 2, lines: [{ rawLineItemId: 1, qty: 30 }] },
  ];
  assert.deepEqual(Array.from(loadRowArticleTags({ rows, activeLines: lines, obdTag: "4 Drum, 10 Carton" }).entries()), [
    [10, "4 D · 5 C"],
    [11, "5 C"],
  ]);
  // 7 cartons over 3 trucks → 2.3 / 2.3 / 2.4 → "~2 C" each; the same shares as the Article column.
  const three = [1, 2, 3].map((seq) => ({ id: 100 + seq, seq, lines: [{ rawLineItemId: 1, qty: 14 }] }));
  const t = loadRowArticleTags({ rows: three, activeLines: [{ rawLineItemId: 1, unitQty: 42, articleTag: "7 Carton" }], obdTag: "7 Carton" });
  assert.deepEqual(Array.from(t.values()), ["~2 C", "~2 C", "~2 C"]);
  const a = loadRowArticles({ rows: three, activeLines: [{ rawLineItemId: 1, unitQty: 42, article: 7 }], totalArticle: 7 });
  assert.deepEqual(Array.from(a.values()), [2.3, 2.3, 2.4]);
});

test("loadRowArticleTags: no SAP tag → nothing (the OBD's own '—' stays); a line with no tag → by tins", () => {
  assert.equal(loadRowArticleTags({ rows: I233980_ROWS, activeLines: [], obdTag: null }).size, 0);
  const lines = [{ rawLineItemId: 74260, unitQty: 70, articleTag: null }];
  const t = loadRowArticleTags({
    rows: [{ id: 1, seq: 1, lines: [{ rawLineItemId: 74260, qty: 20 }] }, { id: 2, seq: 2, lines: [{ rawLineItemId: 74260, qty: 50 }] }],
    activeLines: lines,
    obdTag: "70 Drum",
  });
  assert.deepEqual(Array.from(t.entries()), [[1, "20 D"], [2, "50 D"]]);
});

test("Floor article fields: buildInvoiceRows never sets them — unsplit / 18648 payloads keep their exact keys", () => {
  for (const r of buildInvoiceRows({ rows: ROWS, activeLines: LINES, obdKg: 1357 })) {
    assert.equal("articles" in r, false);
    assert.equal("articleTagText" in r, false);
  }
});
