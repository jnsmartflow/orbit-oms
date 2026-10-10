// lib/order-invoices/rules.test.ts — npx tsx --test lib/order-invoices/rules.test.ts
//
// Add invoices (2026-10-10): normaliseInvoiceNo, validateSplit, detectStale,
// addInvoicesRefusal. Pure — no database. The fixture is the live OBD that
// started the feature, 9109951956: 4 lines, 50 tins, SKU 9296830 on TWO lines.

import test from "node:test";
import assert from "node:assert/strict";
import {
  addInvoicesRefusal,
  detectStale,
  normaliseInvoiceNo,
  validateSplit,
  type ActiveLine,
  type SplitInvoiceInput,
} from "./rules";

const SAP = "I536230716";

const LINES: ActiveLine[] = [
  { rawLineItemId: 62850, lineId: 900001, skuCodeRaw: "5880380", unitQty: 13 },
  { rawLineItemId: 62851, lineId: 900002, skuCodeRaw: "5963121", unitQty: 12 },
  { rawLineItemId: 62852, lineId: 900003, skuCodeRaw: "9296830", unitQty: 10 },
  { rawLineItemId: 62853, lineId: 900004, skuCodeRaw: "9296830", unitQty: 15 },
];

/** The mockup's split: SAP takes lines 1 + 4, two typed invoices take 2 and 3. */
function goodSplit(): SplitInvoiceInput[] {
  return [
    { invoiceNo: SAP, lines: [{ rawLineItemId: 62850, qty: 13 }, { rawLineItemId: 62853, qty: 15 }] },
    { invoiceNo: "I536230713", lines: [{ rawLineItemId: 62851, qty: 12 }] },
    { invoiceNo: "I536230714", lines: [{ rawLineItemId: 62852, qty: 10 }] },
  ];
}

function errorsMatch(errors: string[], re: RegExp): boolean {
  return errors.some((e) => re.test(e));
}

// ── normaliseInvoiceNo ───────────────────────────────────────────────────────

test("normalise: trims, uppercases, bare 9 digits get the I prefix", () => {
  assert.equal(normaliseInvoiceNo("  i536230713 "), "I536230713");
  assert.equal(normaliseInvoiceNo("536230713"), "I536230713");
  assert.equal(normaliseInvoiceNo("I536230713"), "I536230713");
  assert.equal(normaliseInvoiceNo("   "), "");
});

test("normalise: CI's rule leaves 4 digits alone, so validate refuses them as a number", () => {
  assert.equal(normaliseInvoiceNo("0713"), "0713");
  const split = goodSplit();
  split[1].invoiceNo = normaliseInvoiceNo("0713");
  assert.ok(errorsMatch(validateSplit(LINES, split, SAP), /not an invoice number/));
});

// ── validateSplit ────────────────────────────────────────────────────────────

test("a correct split has no errors", () => {
  assert.deepEqual(validateSplit(LINES, goodSplit(), SAP), []);
});

test("fewer than 2 invoices is refused", () => {
  const one: SplitInvoiceInput[] = [{ invoiceNo: SAP, lines: LINES.map((l) => ({ rawLineItemId: l.rawLineItemId, qty: l.unitQty })) }];
  assert.ok(errorsMatch(validateSplit(LINES, one, SAP), /at least 2 invoices/));
});

test("no SAP invoice yet: wait for SAP, nothing else checked", () => {
  assert.deepEqual(validateSplit(LINES, goodSplit(), null), [
    "Wait for the SAP invoice — this bill has no invoice number from SAP yet",
  ]);
});

test("invoice 1 must be the SAP number unchanged", () => {
  const split = goodSplit();
  split[0].invoiceNo = "I536230799";
  assert.ok(errorsMatch(validateSplit(LINES, split, SAP), /must be the SAP invoice I536230716/));
});

test("duplicate number within the OBD is refused (typed twice, or typed = SAP)", () => {
  const twice = goodSplit();
  twice[2].invoiceNo = "I536230713";
  assert.ok(errorsMatch(validateSplit(LINES, twice, SAP), /I536230713 is entered twice/));
  const sapAgain = goodSplit();
  sapAgain[1].invoiceNo = SAP;
  assert.ok(errorsMatch(validateSplit(LINES, sapAgain, SAP), /I536230716 is entered twice/));
});

test("blank number is refused", () => {
  const split = goodSplit();
  split[1].invoiceNo = "";
  assert.ok(errorsMatch(validateSplit(LINES, split, SAP), /Invoice 2 has no invoice number/));
});

test("an invoice with no lines is refused", () => {
  const split = goodSplit();
  split.push({ invoiceNo: "I536230715", lines: [] });
  assert.ok(errorsMatch(validateSplit(LINES, split, SAP), /I536230715 has no items ticked/));
});

test("qty must be a whole number above 0", () => {
  const zero = goodSplit();
  zero[1].lines[0].qty = 0;
  assert.ok(errorsMatch(validateSplit(LINES, zero, SAP), /whole number of tins above 0/));
  const frac = goodSplit();
  frac[1].lines[0].qty = 1.5;
  assert.ok(errorsMatch(validateSplit(LINES, frac, SAP), /whole number of tins above 0/));
});

test("tins under-placed: names the line and how many are missing", () => {
  const split = goodSplit();
  split[2].lines[0].qty = 7;
  assert.ok(errorsMatch(validateSplit(LINES, split, SAP), /line 900003 \(9296830\): 3 of 10 tins not placed/));
});

test("tins over-placed across invoices is refused", () => {
  const split = goodSplit();
  split[1].lines.push({ rawLineItemId: 62850, qty: 2 });
  assert.ok(errorsMatch(validateSplit(LINES, split, SAP), /line 900001 \(5880380\): 15 tins placed but the bill has only 13/));
});

test("part-qty of one line across two invoices is allowed when it adds up", () => {
  const split = goodSplit();
  split[0].lines[0].qty = 8;
  split[1].lines.push({ rawLineItemId: 62850, qty: 5 });
  assert.deepEqual(validateSplit(LINES, split, SAP), []);
});

test("a line that is not an active line of this OBD is refused", () => {
  const split = goodSplit();
  split[1].lines.push({ rawLineItemId: 99999, qty: 1 });
  assert.ok(errorsMatch(validateSplit(LINES, split, SAP), /item 99999 is not a line of this bill/));
});

test("same SKU on two lines is kept apart by line id", () => {
  // Swap the two 9296830 lines' tins: 15 on line 900003 (has 10), 10 on 900004 (has 15).
  const split = goodSplit();
  split[2].lines = [{ rawLineItemId: 62852, qty: 15 }];
  split[0].lines[1] = { rawLineItemId: 62853, qty: 10 };
  const errors = validateSplit(LINES, split, SAP);
  assert.ok(errorsMatch(errors, /line 900003 \(9296830\): 15 tins placed but the bill has only 10/));
  assert.ok(errorsMatch(errors, /line 900004 \(9296830\): 5 of 15 tins not placed/));
});

test("a line listed twice on one invoice is refused", () => {
  const split = goodSplit();
  split[1].lines.push({ rawLineItemId: 62851, qty: 1 });
  assert.ok(errorsMatch(validateSplit(LINES, split, SAP), /line 900002 \(5963121\) is listed twice/));
});

test("a line SAP shipped 0 tins of need not be placed", () => {
  const lines = [...LINES, { rawLineItemId: 62854, lineId: 900005, skuCodeRaw: "1", unitQty: 0 }];
  assert.deepEqual(validateSplit(lines, goodSplit(), SAP), []);
});

// ── detectStale ──────────────────────────────────────────────────────────────

const savedOf = (split: SplitInvoiceInput[]) => split.flatMap((i) => i.lines);

test("stale: an unsplit OBD (no saved lines) is never stale", () => {
  assert.equal(detectStale(LINES, []), false);
});

test("stale: a saved split that still adds up is not stale", () => {
  assert.equal(detectStale(LINES, savedOf(goodSplit())), false);
});

test("stale: a saved line soft-removed by re-import", () => {
  const active = LINES.filter((l) => l.rawLineItemId !== 62852);
  assert.equal(detectStale(active, savedOf(goodSplit())), true);
});

test("stale: re-import patched a line's tins", () => {
  const active = LINES.map((l) => (l.rawLineItemId === 62851 ? { ...l, unitQty: 14 } : l));
  assert.equal(detectStale(active, savedOf(goodSplit())), true);
});

test("stale: re-import added a line nobody placed", () => {
  const active = [...LINES, { rawLineItemId: 62860, lineId: 900006, skuCodeRaw: "7", unitQty: 4 }];
  assert.equal(detectStale(active, savedOf(goodSplit())), true);
});

// ── addInvoicesRefusal ───────────────────────────────────────────────────────

test("refusal: removed / cancelled / dispatched / closed / no SAP invoice; a trip is fine", () => {
  const ok = { isRemoved: false, workflowStage: "pick_checked", sapInvoiceNo: SAP };
  assert.equal(addInvoicesRefusal(ok), null);
  assert.match(addInvoicesRefusal({ ...ok, isRemoved: true }) ?? "", /removed/);
  assert.match(addInvoicesRefusal({ ...ok, workflowStage: "cancelled" }) ?? "", /cancelled/);
  assert.match(addInvoicesRefusal({ ...ok, workflowStage: "dispatched" }) ?? "", /dispatched/);
  assert.match(addInvoicesRefusal({ ...ok, workflowStage: "closed" }) ?? "", /closed/);
  assert.match(addInvoicesRefusal({ ...ok, sapInvoiceNo: null }) ?? "", /Wait for the SAP invoice/);
});
