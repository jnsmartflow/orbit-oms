// lib/order-invoices/hold.test.ts — npx tsx --test lib/order-invoices/hold.test.ts
//
// Add invoices 6.1 (2026-10-19): the per-invoice hold plan (holdRows /
// releaseRows) and the derived OBD status. Pure — no database. Fixture: order
// 18648 (rows 17010 / 36798 / 36799 / 36800 = …716 / 713 / 714 / 715).

import test from "node:test";
import assert from "node:assert/strict";
import { invoiceLabel, mirrorArgs, planRowsHold, rowHoldRefusal, unholdStatusFor, type HoldRow } from "./hold";

const NOS = ["I536230716", "I536230713", "I536230714", "I536230715"];
const rows18648 = (held: boolean[], trips: (string | null)[] = [null, null, null, null]): HoldRow[] =>
  [17010, 36798, 36799, 36800].map((id, i) => ({
    id,
    seq: i + 1,
    invoiceNo: NOS[i],
    isHeld: held[i],
    isDispatched: false,
    tripDropId: trips[i] === null ? null : 2763,
    tripNumber: trips[i],
  }));
const OBD = { dispatchStatus: "dispatch", workflowStage: "pick_checked" };
const HELD_OBD = { dispatchStatus: "hold", workflowStage: "pick_checked" };

test("hold partial: 716 + 714 held, the OBD stays 'dispatch' (no orders write)", () => {
  const p = planRowsHold(rows18648([false, false, false, false]), [17010, 36799], true, OBD);
  assert.deepEqual(p.rowIdsToUpdate, [17010, 36799]);
  assert.deepEqual(p.refused, []);
  assert.equal(p.obdStatus, undefined);
  assert.equal(p.allHeld, false);
});

test("hold the rest: every row held → the OBD becomes 'hold'", () => {
  const p = planRowsHold(rows18648([true, false, true, false]), [36798, 36800], true, OBD);
  assert.deepEqual(p.rowIdsToUpdate, [36798, 36800]);
  assert.equal(p.obdStatus, "hold");
  assert.equal(p.allHeld, true);
});

test("release one row of an all-held OBD → the existing unhold rule, from the stage", () => {
  const p = planRowsHold(rows18648([true, true, true, true]), [36799], false, HELD_OBD);
  assert.deepEqual(p.rowIdsToUpdate, [36799]);
  assert.equal(p.obdStatus, "dispatch");
  const early = planRowsHold(rows18648([true, true, true, true]), [36799], false, { dispatchStatus: "hold", workflowStage: "pending_support" });
  assert.equal(early.obdStatus, null);
  assert.equal(unholdStatusFor("pick_checked"), "dispatch");
  assert.equal(unholdStatusFor("pending_support"), null);
});

test("release the last held row of a partly-held OBD: rows only, OBD untouched", () => {
  const p = planRowsHold(rows18648([false, false, true, false]), [36799], false, OBD);
  assert.deepEqual(p.rowIdsToUpdate, [36799]);
  assert.equal(p.obdStatus, undefined);
});

test("on-trip and dispatched rows are refused ONE BY ONE; the rest are held", () => {
  const rows = rows18648([false, false, false, false], [null, "L-261019-02", null, null]);
  rows[3].isDispatched = true;
  const p = planRowsHold(rows, [17010, 36798, 36800], true, OBD);
  assert.deepEqual(p.rowIdsToUpdate, [17010]);
  assert.deepEqual(
    p.refused.map((r) => r.error),
    ["I536230713 is on L-261019-02 — remove it from the trip first", "I536230715 is dispatched — it cannot be held"],
  );
  assert.equal(p.obdStatus, undefined);
});

test("a release is never refused for a trip (only holding is)", () => {
  const p = planRowsHold(rows18648([true, false, false, false], [null, "L-02", null, null]), [17010], false, OBD);
  assert.deepEqual(p.rowIdsToUpdate, [17010]);
  assert.deepEqual(p.refused, []);
});

test("retry after a half-write: rows already held, orders stale → only the orders write", () => {
  // The press held the last two rows and died before orders.update.
  const p = planRowsHold(rows18648([true, true, true, true]), [36798, 36800], true, OBD);
  assert.deepEqual(p.rowIdsToUpdate, []);
  assert.equal(p.obdStatus, "hold");
  // …and a release that died the same way.
  const r = planRowsHold(rows18648([true, false, true, true]), [36798], false, HELD_OBD);
  assert.deepEqual(r.rowIdsToUpdate, []);
  assert.equal(r.obdStatus, "dispatch");
});

test("a repeat press changes nothing and writes nothing", () => {
  const p = planRowsHold(rows18648([true, false, true, false]), [17010, 36799], true, OBD);
  assert.deepEqual(p.rowIdsToUpdate, []);
  assert.equal(p.obdStatus, undefined);
});

test("ids that are not the OBD's rows are ignored by the plan", () => {
  const p = planRowsHold(rows18648([false, false, false, false]), [99999], true, OBD);
  assert.deepEqual(p.rowIdsToUpdate, []);
  assert.equal(p.obdStatus, undefined);
});

test("labels and the single-row refusal", () => {
  assert.equal(invoiceLabel({ seq: 3, invoiceNo: null }), "Invoice 3");
  assert.equal(rowHoldRefusal(rows18648([false, false, false, false])[0]), null);
  assert.equal(rowHoldRefusal({ ...rows18648([false, false, false, false])[0], tripDropId: 5, tripNumber: null }), "I536230716 is on a trip — remove it from the trip first");
});

// ── mirrorObdHold (every OBD-level writer) ──────────────────────────────────

test("mirror: an OBD hold sets every NOT-held row of that OBD, wall clock + actor", () => {
  const now = new Date("2026-10-19T06:00:00.000Z");
  assert.deepEqual(mirrorArgs(18648, true, 7, now), {
    where: { order: { id: 18648 }, isHeld: false, isDispatched: false },
    data: { isHeld: true, heldAt: now, heldById: 7 },
  });
});

test("mirror: a release / cancel clears every held row; an SO-keyed where passes through", () => {
  const now = new Date();
  assert.deepEqual(mirrorArgs({ soNumber: "S1", isRemoved: false }, false, null, now), {
    where: { order: { soNumber: "S1", isRemoved: false }, isHeld: true },
    data: { isHeld: false, heldAt: null, heldById: null },
  });
});
