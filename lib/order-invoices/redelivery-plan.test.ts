// lib/order-invoices/redelivery-plan.test.ts — npx tsx --test lib/order-invoices/redelivery-plan.test.ts
//
// Add invoices P5-5 (2026-10-23): per-invoice re-deliveries. Pure — no
// database. Fixture: order 18648 (rows 17010 / 36798 / 36799 / 36800 = …716 /
// 713 / 714 / 715), re-deliveries 28 → 36798 and 86 → 36800 on trip 668,
// stop 2763.

import test from "node:test";
import assert from "node:assert/strict";
import {
  MSG_INVOICE_HELD,
  MSG_INVOICE_NOT_GONE,
  dedupeObdAttempts,
  groupRedeliveries,
  invoiceRefusal,
  redeliveryCountsByTrip,
  redeliveryTargetsOf,
} from "./redelivery-plan";
import { invoicesLoad } from "../floor/invoice-rows";
import { attemptNoFor, prevTripIdFor, type AttemptHistoryEntry } from "../trips/redelivery";

const ROWS = [
  { id: 36800, seq: 4, invoiceNo: "I536230715" },
  { id: 17010, seq: 1, invoiceNo: "I536230716" },
  { id: 36798, seq: 2, invoiceNo: "I536230713" },
  { id: 36799, seq: 3, invoiceNo: "I536230714" },
];

test("targets: unsplit → the whole OBD (null); split by OBD number → every invoice, seq order", () => {
  assert.equal(redeliveryTargetsOf({ split: false, rows: [ROWS[1]] }, []), null);
  assert.deepEqual(redeliveryTargetsOf({ split: true, rows: ROWS }, [])!.map((r) => r.id), [17010, 36798, 36799, 36800]);
});

test("targets: an invoice number naming one row of a split OBD → that invoice only", () => {
  assert.deepEqual(redeliveryTargetsOf({ split: true, rows: ROWS }, [36800])!.map((r) => r.id), [36800]);
  assert.deepEqual(redeliveryTargetsOf({ split: true, rows: ROWS }, [999])!.length, 4); // not one of its rows
});

const entry = (tripId: number, kind: "original" | "redelivery", day: string): AttemptHistoryEntry => ({
  tripId,
  tripNumber: `T${tripId}`,
  tripDate: day,
  kind,
  reason: null,
  reasonLabel: null,
  createdAt: `${day}T10:00:00.000Z`,
  vehiclePlate: null,
  driverName: null,
  driverPhone: null,
});

test("attempts per invoice: 713 went on 605 and came back on 668 → a next re-delivery is attempt 3 from 668", () => {
  const h713 = [entry(605, "original", "2026-10-06"), entry(668, "redelivery", "2026-10-07")];
  assert.equal(attemptNoFor(h713), 3);
  assert.equal(prevTripIdFor(h713), 668);
  // 716 was never on a truck → attempt 2 if it ever qualified, no previous trip.
  assert.equal(attemptNoFor([]), 2);
  assert.equal(prevTripIdFor([]), null);
});

test("refusal: a held invoice, or one that never went out, cannot be re-delivered", () => {
  assert.equal(invoiceRefusal({ isHeld: true, isDispatched: false }, [entry(605, "original", "2026-10-06")]), MSG_INVOICE_HELD);
  assert.equal(invoiceRefusal({ isHeld: false, isDispatched: false }, []), MSG_INVOICE_NOT_GONE);
  assert.equal(invoiceRefusal({ isHeld: false, isDispatched: true }, []), null);
  assert.equal(invoiceRefusal({ isHeld: false, isDispatched: false }, [entry(605, "original", "2026-10-06")]), null);
});

test("group: 28 + 86 are ONE carried bill on stop 2763 with two invoices; unsplit records stay one each", () => {
  const recs = [
    { id: 28, tripId: 668, tripDropId: 2763, orderId: 18648, orderInvoiceId: 36798 },
    { id: 40, tripId: 668, tripDropId: 2763, orderId: 500, orderInvoiceId: 5000 },
    { id: 86, tripId: 668, tripDropId: 2763, orderId: 18648, orderInvoiceId: 36800 },
  ];
  const g = groupRedeliveries(recs);
  assert.deepEqual(g.map((x) => [x.first.id, x.rowIds]), [[28, [36798, 36800]], [40, [5000]]]);
  assert.deepEqual(Array.from(redeliveryCountsByTrip(recs)), [[668, 2]]);
});

test("load: trip 668 carries 713 + 715 = 460 L, not 18648's 1,000 L; all four or unsplit → null (OBD totals)", () => {
  const inv = (id: number, litres: number, kg: number) => ({ id, tripDropId: null, litres, kg, kgExact: true, tins: 1 });
  const rows = [inv(17010, 340, 268.5), inv(36798, 260, 356.33), inv(36799, 200, 461.86), inv(36800, 200, 270.3)];
  const l = invoicesLoad(rows, [36798, 36800])!;
  assert.equal(l.litres, 460);
  assert.equal(Math.round(l.kg! * 100) / 100, 626.63);
  assert.equal(l.invoices, 2);
  assert.equal(invoicesLoad(rows, [17010, 36798, 36799, 36800]), null);
  assert.equal(invoicesLoad([inv(500, 100, 50)], [500]), null);
});

test("history of the OBD: two invoices re-delivered on one trip are ONE attempt there", () => {
  const h = [entry(605, "original", "2026-10-06"), entry(668, "redelivery", "2026-10-07"), entry(668, "redelivery", "2026-10-07")];
  assert.deepEqual(dedupeObdAttempts(h).map((x) => x.tripId), [605, 668]);
});

// ── Split load, Phase 4 batch 4: a load group found by its number offers every part ──

test("targets: several matched rows (I536233980's two parts) → all of them, seq order; one → as today", () => {
  const LOAD = [
    { id: 41213, seq: 2, invoiceNo: "I536233980" },
    { id: 40777, seq: 1, invoiceNo: "I536233980" },
  ];
  assert.deepEqual(redeliveryTargetsOf({ split: true, rows: LOAD }, [41213, 40777])!.map((r) => r.id), [40777, 41213]);
  assert.deepEqual(redeliveryTargetsOf({ split: true, rows: LOAD }, [41213])!.map((r) => r.id), [41213]);
  assert.deepEqual(redeliveryTargetsOf({ split: true, rows: ROWS }, [36798])!.map((r) => r.id), [36798]);
});
