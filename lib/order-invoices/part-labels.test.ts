// lib/order-invoices/part-labels.test.ts — npx tsx --test lib/order-invoices/part-labels.test.ts
//
// Split load phase 4 batch 5 (F11): every refusal / log text names a truck
// part "I… part k of n" — and a row outside a load group (unsplit, Add
// invoices 18648) reads EXACTLY what it read before. Pure — no database.
// Fixtures: order 22179 / OBD 9110345576, I536233980 part 1 (row 40777,
// L-261024-22) and part 2 (row 41213, 'load', L-261024-23); order 18648 / OBD
// 9109951956 (17010 …716, 36798 …713, 36799 …714, 36800 …715).

import test from "node:test";
import assert from "node:assert/strict";
import { loadPartsOf, withLoadPart } from "./load-plan";
import { invoiceLabel as holdLabel, planRowsHold, rowHoldRefusal, type HoldRow } from "./hold";
import { invoiceLabel as tripLabel, planAddRows, planRemoveRows, rowLabelOf, type TripBillRow } from "./trip-bills";
import { redeliveryItemDetail, redeliveryItemText } from "@/lib/trips/activity";
import { redeliveryReasonLabel } from "@/lib/trips/redelivery-reasons";

const LOAD = [
  { id: 40777, seq: 1, loadParentId: null },
  { id: 41213, seq: 2, loadParentId: 40777 },
];
const ADD_18648 = [17010, 36798, 36799, 36800].map((id, i) => ({ id, seq: i + 1, loadParentId: null }));

test("loadPartsOf: both parts of I536233980; nothing for 18648 or an unsplit bill", () => {
  const p = loadPartsOf(LOAD);
  assert.deepEqual(p.get(40777), { k: 1, n: 2, rootSeq: 1 });
  assert.deepEqual(p.get(41213), { k: 2, n: 2, rootSeq: 1 });
  assert.equal(loadPartsOf(ADD_18648).size, 0);
  assert.equal(loadPartsOf([{ id: 500, seq: 1, loadParentId: null }]).size, 0);
  // A mixed bill: an Add-invoices paper beside a split one — only the group's rows.
  const mixed = loadPartsOf([...ADD_18648.slice(0, 2), { id: 40001, seq: 3, loadParentId: 36798 }]);
  assert.deepEqual(Array.from(mixed.keys()).sort(), [36798, 40001]);
  assert.deepEqual(mixed.get(40001), { k: 2, n: 2, rootSeq: 2 });
});

test("withLoadPart: absent → the very same string", () => {
  for (const s of ["I536230713", "Invoice 2", "Invoice 2 of 9109951956", ""]) assert.equal(withLoadPart(s), s);
  assert.equal(withLoadPart("I536233980", { k: 2, n: 2 }), "I536233980 part 2 of 2");
});

// ── hold.ts ──────────────────────────────────────────────────────────────────

const holdRow = (over: Partial<HoldRow> & Pick<HoldRow, "id" | "seq">): HoldRow => ({
  invoiceNo: "I536233980",
  isHeld: false,
  isDispatched: false,
  tripDropId: null,
  tripNumber: null,
  ...over,
});

test("hold invoiceLabel: part absent → today's words; present → 'part k of n'", () => {
  assert.equal(holdLabel({ seq: 2, invoiceNo: "I536230713" }), "I536230713");
  assert.equal(holdLabel({ seq: 2, invoiceNo: null }), "Invoice 2");
  assert.equal(holdLabel({ seq: 2, invoiceNo: "I536233980", part: { k: 2, n: 2, rootSeq: 1 } }), "I536233980 part 2 of 2");
  assert.equal(holdLabel({ seq: 2, invoiceNo: null, part: { k: 2, n: 2, rootSeq: 1 } }), "Invoice 1 part 2 of 2");
});

test("hold refusals: a part on a trip / dispatched names the part; 18648 reads as before", () => {
  const part2 = holdRow({ id: 41213, seq: 2, tripDropId: 5816, tripNumber: "L-261024-23", part: { k: 2, n: 2, rootSeq: 1 } });
  assert.equal(rowHoldRefusal(part2), "I536233980 part 2 of 2 is on L-261024-23 — remove it from the trip first");
  assert.equal(rowHoldRefusal({ ...part2, isDispatched: true }), "I536233980 part 2 of 2 is dispatched — it cannot be held");
  const r713 = holdRow({ id: 36798, seq: 2, invoiceNo: "I536230713", tripDropId: 2763, tripNumber: "L-261007-20" });
  assert.equal(rowHoldRefusal(r713), "I536230713 is on L-261007-20 — remove it from the trip first");
  assert.equal(rowHoldRefusal({ ...r713, isDispatched: true }), "I536230713 is dispatched — it cannot be held");
  const plan = planRowsHold([holdRow({ id: 40777, seq: 1, part: { k: 1, n: 2, rootSeq: 1 } }), part2], [41213], true, { dispatchStatus: "dispatch", workflowStage: "pick_checked" });
  assert.deepEqual(plan.refused.map((x) => x.error), ["I536233980 part 2 of 2 is on L-261024-23 — remove it from the trip first"]);
});

// ── trip-bills.ts (the bills route, ship-to) ────────────────────────────────

type Place = Pick<TripBillRow, "tripDropId" | "tripId" | "dropKey" | "tripNumber">;
const OFF: Place = { tripDropId: null, tripId: null, dropKey: null, tripNumber: null };
const ON_22: Place = { tripDropId: 5815, tripId: 1295, dropKey: "C:1", tripNumber: "L-261024-22" };
const ON_23: Place = { tripDropId: 5816, tripId: 1296, dropKey: "C:1", tripNumber: "L-261024-23" };
const load22179 = (p1: Place, p2: Place, over2: Partial<TripBillRow> = {}): TripBillRow[] => [
  { id: 40777, seq: 1, invoiceNo: "I536233980", loadRootId: 40777, ...p1 },
  { id: 41213, seq: 2, invoiceNo: "I536233980", loadRootId: 40777, ...p2, ...over2 },
];
const r18648 = (places: (Place)[], over: Partial<TripBillRow>[] = []): TripBillRow[] =>
  ["I536230716", "I536230713", "I536230714", "I536230715"].map((no, i) => ({
    id: [17010, 36798, 36799, 36800][i],
    seq: i + 1,
    invoiceNo: no,
    ...places[i],
    ...(over[i] ?? {}),
  }));
const OBD = "9110345576";

test("trip-bills invoiceLabel: part absent → today's words (number, else 'Invoice k of OBD')", () => {
  assert.equal(tripLabel({ seq: 2, invoiceNo: "I536230713" }, "9109951956"), "I536230713");
  assert.equal(tripLabel({ seq: 2, invoiceNo: null }, "9109951956"), "Invoice 2 of 9109951956");
  assert.equal(tripLabel({ seq: 2, invoiceNo: "I536233980", part: { k: 2, n: 2, rootSeq: 1 } }, OBD), "I536233980 part 2 of 2");
  assert.equal(rowLabelOf(load22179(ON_22, ON_23), { id: 41213, seq: 2, invoiceNo: "I536233980" }, OBD), "I536233980 part 2 of 2");
  assert.equal(rowLabelOf(r18648([OFF, OFF, OFF, OFF]), { id: 36798, seq: 2, invoiceNo: "I536230713" }, "9109951956"), "I536230713");
});

test("trip add: a held part / a part with a CI / a part on another trip — each names the part", () => {
  assert.deepEqual(planAddRows(load22179(ON_22, OFF, { isHeld: true }), [41213], 1300, "C:1", OBD).refused.map((x) => x.error), [
    "I536233980 part 2 of 2 is on hold — release it first",
  ]);
  assert.deepEqual(planAddRows(load22179(ON_22, OFF, { ciNumber: "CI-2026-00700" }), [41213], 1300, "C:1", OBD).refused.map((x) => x.error), [
    "I536233980 part 2 of 2 is returned on CI-2026-00700 — it does not go out",
  ]);
  assert.deepEqual(planAddRows(load22179(ON_22, ON_23), [41213], 1300, "C:1", OBD).refused.map((x) => x.error), [
    "I536233980 part 2 of 2 is already on L-261024-23 — remove it from that trip first",
  ]);
});

test("trip add / remove: 18648 (Add invoices) — every refusal byte for byte as before", () => {
  const held = r18648([OFF, OFF, OFF, OFF], [{}, { isHeld: true }, { ciNumber: "" }, {}]);
  assert.deepEqual(planAddRows(held, [36798, 36799], 668, "C:1", "9109951956").refused.map((x) => x.error), [
    "I536230713 is on hold — release it first",
    "I536230714 is returned on a CI — it does not go out",
  ]);
  const away = r18648([OFF, ON_22, OFF, OFF]);
  assert.deepEqual(planAddRows(away, [36798], 668, "C:1", "9109951956").refused.map((x) => x.error), [
    "I536230713 is already on L-261024-22 — remove it from that trip first",
  ]);
  assert.deepEqual(planRemoveRows(away, [36799], 1295, "9109951956").refused.map((x) => x.error), ["I536230714 is not on this trip"]);
  const noNo = r18648([OFF, OFF, OFF, OFF], [{}, { invoiceNo: null }]);
  assert.deepEqual(planRemoveRows(noNo, [36798], 1295, "9109951956").refused.map((x) => x.error), ["Invoice 2 of 9109951956 is not on this trip"]);
});

test("trip remove: a part not on this trip names the part", () => {
  assert.deepEqual(planRemoveRows(load22179(ON_22, ON_23), [41213], 1295, OBD).refused.map((x) => x.error), ["I536233980 part 2 of 2 is not on this trip"]);
});

test("ship-to's 'split across trips' list (invoiceLabel + loadPartsOf, as ship-to-on-trip.ts builds it)", () => {
  const parts = loadPartsOf(LOAD);
  const where = [
    { id: 40777, seq: 1, invoiceNo: "I536233980", trip: "L-261024-22" },
    { id: 41213, seq: 2, invoiceNo: "I536233980", trip: "L-261024-23" },
  ]
    .map((r) => `${tripLabel({ ...r, part: parts.get(r.id) }, OBD)} on ${r.trip}`)
    .join(", ");
  assert.equal(where, "I536233980 part 1 of 2 on L-261024-22, I536233980 part 2 of 2 on L-261024-23");
  // 18648: no parts → the bare numbers, as before.
  const none = loadPartsOf(ADD_18648);
  assert.equal(`${tripLabel({ seq: 2, invoiceNo: "I536230713", part: none.get(36798) }, "9109951956")} on L-261006-05`, "I536230713 on L-261006-05");
});

// ── activity.ts — re-delivery log items ──────────────────────────────────────

const REASON = "site_closed";

test("re-delivery log text: unsplit and 18648 exactly as before; a part says 'part k of n'", () => {
  const label = redeliveryReasonLabel(REASON);
  const unsplit = { orderId: 2, obd: "9110400001", attemptNo: 2, reason: REASON };
  assert.equal(redeliveryItemText(unsplit), `9110400001 (attempt 2, ${label})`);
  const add = { ...unsplit, orderId: 18648, obd: "9109951956", invoiceNo: "I536230713" };
  assert.equal(redeliveryItemText(add), `9109951956 · I536230713 (attempt 2, ${label})`);
  const part = { ...unsplit, orderId: 22179, obd: "9110345576", invoiceNo: "I536233980", orderInvoiceId: 41213, part: { k: 2, n: 2 } };
  assert.equal(redeliveryItemText(part), `9110345576 · I536233980 part 2 of 2 (attempt 2, ${label})`);
  assert.equal(redeliveryItemText({ ...part, invoiceNo: null }), `9110345576 · part 2 of 2 (attempt 2, ${label})`);
});

test("re-delivery log detail: the added keys appear ONLY when present (old items read the same)", () => {
  const unsplit = { orderId: 2, obd: "9110400001", attemptNo: 2, reason: REASON };
  assert.deepEqual(redeliveryItemDetail(unsplit), { orderId: 2, obd: "9110400001", attemptNo: 2, reason: REASON });
  const add = { ...unsplit, invoiceNo: "I536230713" };
  assert.deepEqual(redeliveryItemDetail(add), { orderId: 2, obd: "9110400001", attemptNo: 2, reason: REASON, invoiceNo: "I536230713" });
  const part = { ...add, invoiceNo: "I536233980", orderInvoiceId: 41213, part: { k: 2, n: 2 } };
  assert.deepEqual(redeliveryItemDetail(part), { ...redeliveryItemDetail({ ...add, invoiceNo: "I536233980" }), orderInvoiceId: 41213, part: { k: 2, n: 2 } });
});
