// npx tsx --test lib/trip-sheet/totals.test.ts — Q5 bill counting (per-part ship-to, v27.81)
import { test } from "node:test";
import assert from "node:assert/strict";
import { billCountOf, summariseStops } from "./totals";
import type { TripSheetBill, TripSheetStop } from "./types";

const bill = (orderId: number, obd: string, litres: number, redel = false): TripSheetBill =>
  ({ orderId, obd, litres, kg: 1, articles: 1, gift: false, redel, soName: null, soId: null } as unknown as TripSheetBill);
const stop = (dropId: number, dropSeq: number, bills: TripSheetBill[]): TripSheetStop =>
  ({ no: 0, dropId, dropSeq, name: `S${dropId}`, area: null, isSite: false, bills } as TripSheetStop);

test("one line per bill (all live data): bills = lines, unchanged", () => {
  const s = summariseStops([stop(1, 1, [bill(10, "A", 100), bill(11, "B", 50)]), stop(2, 2, [bill(12, "C", 25)])]);
  assert.equal(s.totals.bills, 3);
  assert.equal(s.totals.stops, 2);
  assert.equal(s.totals.litres, 175);
});

test("Q5: one OBD at two stops = 1 bill, 2 stops; litres are both stops'", () => {
  const s = summariseStops([stop(1, 1, [bill(10, "A", 1200)]), stop(2, 2, [bill(10, "A", 800)])]);
  assert.equal(s.totals.bills, 1);
  assert.equal(s.totals.stops, 2);
  assert.equal(s.totals.litres, 2000);
});

test("a re-delivery stays its own bill beside the trip's own copy of the OBD (as before)", () => {
  assert.equal(billCountOf([stop(1, 1, [bill(10, "A", 1), bill(10, "A", 1, true)])]), 2);
});
