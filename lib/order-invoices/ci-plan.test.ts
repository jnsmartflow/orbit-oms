// lib/order-invoices/ci-plan.test.ts — npx tsx --test lib/order-invoices/ci-plan.test.ts
//
// Add invoices 6.3 (2026-10-19): a CI per invoice — lines limited to the
// invoice, one CI per invoice row, the on-trip refusal, the duplicate guard.
// Pure — no database. Fixture: order 18648's rows (…716 / 713 / 714 / 715).

import test from "node:test";
import assert from "node:assert/strict";
import { ciCoversRow, invoiceCiDuplicate, invoiceCiPicks, invoiceCiRefusal, SPLIT_BILL_CI_PAGE, type CiInvoiceRow } from "./ci-plan";
import { SPLIT_BILL_CI_PAGE as BOARD_SPLIT_BILL_CI_PAGE } from "./load-plan";

const row = (over: Partial<CiInvoiceRow> = {}): CiInvoiceRow => ({
  id: 36798,
  seq: 2,
  invoiceNo: "I536230713",
  tripDropId: null,
  tripNumber: null,
  isDispatched: false,
  lines: [{ rawLineItemId: 62850, qty: 13 }],
  ...over,
});
const ACTIVE = [
  { id: 62850, skuCodeRaw: "A", unitQty: 13, volumeLine: 260 },
  { id: 62851, skuCodeRaw: "B", unitQty: 12, volumeLine: 240 },
  { id: 62853, skuCodeRaw: "C", unitQty: 15, volumeLine: 300 },
];

test("lines: ONLY the invoice's raw lines, at the invoice's tins, in bill order", () => {
  const r = invoiceCiPicks(row({ lines: [{ rawLineItemId: 62853, qty: 5 }, { rawLineItemId: 62850, qty: 13 }] }), ACTIVE);
  assert.ok(r.ok);
  assert.deepEqual(r.picks.map((p) => [p.src.id, p.returnedQty]), [[62850, 13], [62853, 5]]);
});

test("lines: the same raw line twice on one invoice sums its tins", () => {
  const r = invoiceCiPicks(row({ lines: [{ rawLineItemId: 62851, qty: 4 }, { rawLineItemId: 62851, qty: 2 }] }), ACTIVE);
  assert.ok(r.ok);
  assert.deepEqual(r.picks.map((p) => [p.src.id, p.returnedQty]), [[62851, 6]]);
});

test("lines: refused when the invoice has none, a line left SAP, or a line has no tins", () => {
  assert.equal(invoiceCiPicks(row({ lines: [] }), ACTIVE).ok, false);
  const gone = invoiceCiPicks(row({ lines: [{ rawLineItemId: 99999, qty: 1 }] }), ACTIVE);
  assert.ok(!gone.ok && /Lines changed in SAP/.test(gone.reason));
  assert.equal(invoiceCiPicks(row({ lines: [{ rawLineItemId: 62850, qty: 0 }] }), ACTIVE).ok, false);
});

test("refusal: on a trip → remove it first; dispatched → refused; held / plain → allowed", () => {
  assert.equal(
    invoiceCiRefusal(row({ tripDropId: 2763, tripNumber: "L-261019-02" })),
    "I536230713 is on L-261019-02 — remove it from the trip first",
  );
  assert.equal(invoiceCiRefusal(row({ isDispatched: true })), "I536230713 is dispatched — it cannot be returned here");
  assert.equal(invoiceCiRefusal(row()), null);
});

test("duplicate guard per (orderId, orderInvoiceId): its own CI or a whole-OBD CI blocks; another invoice's does not", () => {
  const own = { id: 1, ciNumber: "CI-2026-00500", status: "submitted", orderInvoiceId: 36798 };
  const other = { id: 2, ciNumber: "CI-2026-00501", status: "closed", orderInvoiceId: 36800 };
  const whole = { id: 3, ciNumber: "CI-2026-00502", status: "submitted", orderInvoiceId: null };
  assert.equal(invoiceCiDuplicate([own], 36798), "Already has CI-2026-00500");
  assert.equal(invoiceCiDuplicate([other], 36798), null);
  assert.equal(invoiceCiDuplicate([whole], 36798), "Already has CI-2026-00502");
  assert.equal(invoiceCiDuplicate([{ ...own, status: "draft", ciNumber: null }], 36798), "A CI draft is open on /ci for this bill");
  assert.equal(ciCoversRow(whole, 17010), true);
  assert.equal(ciCoversRow(other, 17010), false);
});

test("one CI per ticked invoice: each row is judged and lined on its own", () => {
  const rows = [row(), row({ id: 36800, seq: 4, invoiceNo: "I536230715", lines: [{ rawLineItemId: 62851, qty: 12 }] })];
  const cis = [{ id: 9, ciNumber: "CI-2026-00600", status: "submitted", orderInvoiceId: 36800 }];
  const plan = rows.map((r) => ({ id: r.id, dup: invoiceCiDuplicate(cis, r.id), picks: invoiceCiPicks(r, ACTIVE) }));
  assert.deepEqual(plan.map((p) => [p.id, p.dup]), [[36798, null], [36800, "Already has CI-2026-00600"]]);
  assert.ok(plan[0].picks.ok && plan[0].picks.picks.length === 1);
});

// ── Split load, Phase 4 batch 2: no CI on a part (text: owner 2026-10-26) ──

test("a row in a load group is refused with the Floor button's own words, first", () => {
  assert.equal(invoiceCiRefusal(row({ inLoadGroup: true })), "Split bill — raise CI from the CI page and choose the SKUs.");
  assert.equal(invoiceCiRefusal(row({ inLoadGroup: true, tripDropId: 5815, tripNumber: "L-261024-22" })), SPLIT_BILL_CI_PAGE);
  assert.equal(SPLIT_BILL_CI_PAGE, BOARD_SPLIT_BILL_CI_PAGE); // one text, re-exported for the board
  assert.equal(invoiceCiRefusal(row({ inLoadGroup: false })), null);
  assert.equal(invoiceCiRefusal(row()), null); // omitted = as before
});
