// npx tsx --test lib/floor/hold-groups.test.ts — per-part ship-to dealer groups (v27.81)
import { test } from "node:test";
import assert from "node:assert/strict";
import { expandHoldByShop, groupHoldByDealer } from "./hold-groups";
import type { FloorInvoiceRow, InvoiceShipTo } from "./invoice-rows";
import type { FloorHoldRow } from "./types";

// The 9110835499 shape, both truck parts held: 60 / 40 tins → 1,200 L and 800 L.
const OBD_SHIP: InvoiceShipTo = {
  own: false,
  dealerName: "Shree Aaiji Hardware",
  isShipToOverride: false,
  shipToOverrideName: null,
  area: "Udhna",
  deliveryType: "Local",
  stopKey: "c:2441",
};
const PART2_OWN: InvoiceShipTo = {
  own: true,
  dealerName: "National Hardware Paints",
  isShipToOverride: true,
  shipToOverrideName: "National Hardware Paints",
  area: "Varachha",
  deliveryType: "Local",
  stopKey: "c:2375",
};

const inv = (id: number, seq: number, litres: number, shipTo: InvoiceShipTo): FloorInvoiceRow => ({
  id,
  seq,
  invoiceNo: "I536299999",
  invoiceDate: null,
  tins: litres / 20,
  litres,
  kg: litres * 1.3,
  kgExact: true,
  stale: false,
  tripDropId: null,
  tripNumber: null,
  tripStatus: null,
  isHeld: true,
  heldAt: "2026-11-19T05:00:00.000Z",
  heldById: 1,
  ci: null,
  isDispatched: false,
  loadRootId: 46099,
  shipTo,
});

const held = (part2: InvoiceShipTo): FloorHoldRow =>
  ({
    orderId: 25130,
    obdNumber: "9110835499",
    dealerName: OBD_SHIP.dealerName,
    isShipToOverride: false,
    area: OBD_SHIP.area,
    deliveryType: OBD_SHIP.deliveryType,
    stopKey: OBD_SHIP.stopKey,
    heldSince: "2026-11-19T05:00:00.000Z",
    heldSinceSource: "log",
    volumeLitres: 2000,
    weightKg: 2600,
    isGift: false,
    invoiceRows: [inv(46099, 1, 1200, OBD_SHIP), inv(46100, 2, 800, part2)],
  }) as unknown as FloorHoldRow;

const other = {
  orderId: 7,
  obdNumber: "9110000007",
  dealerName: "Shree Aaiji Hardware",
  stopKey: "c:2441",
  heldSince: "2026-11-18T05:00:00.000Z",
  heldSinceSource: "log",
  invoiceRows: [],
} as unknown as FloorHoldRow;

test("every part inheriting (all live data): the same row objects, one dealer group", () => {
  const r = held(OBD_SHIP);
  const out = expandHoldByShop([r, other]);
  assert.equal(out.length, 2);
  assert.equal(out[0], r);
  assert.equal(out[1], other);
  const groups = groupHoldByDealer([r, other]);
  assert.deepEqual(groups.map((g) => [g.key, g.rows.map((x) => x.orderId)]), [["c:2441", [25130, 7]]]);
});

test("part 2 → dealer 2375: the OBD sits in BOTH dealer groups, narrowed, 1,200 L and 800 L", () => {
  const groups = groupHoldByDealer([held(PART2_OWN), other]);
  const byKey = new Map(groups.map((g) => [g.key, g]));
  assert.equal(groups.length, 2);
  const a = byKey.get("c:2441")!;
  const b = byKey.get("c:2375")!;
  assert.equal(a.name, "Shree Aaiji Hardware");
  assert.equal(b.name, "National Hardware Paints");
  assert.deepEqual(a.rows.map((r) => [r.orderId, r.volumeLitres, r.invoiceRows.map((i) => i.id)]), [
    [25130, 1200, [46099]],
    [7, undefined, []],
  ]);
  assert.deepEqual(b.rows.map((r) => [r.orderId, r.volumeLitres, r.isShipToOverride, r.invoiceRows.map((i) => i.id)]), [
    [25130, 800, true, [46100]],
  ]);
  // k / n stay OBD-wide.
  assert.equal(b.rows[0].invoiceRowsAll?.length, 2);
});
