// npx tsx --test lib/floor/division-blocks.test.ts — per-part ship-to blocks (v27.81, plan §D.3)
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDivisionBands, expandByShop } from "./division-blocks";
import type { FloorInvoiceRow, InvoiceShipTo } from "./invoice-rows";
import type { FloorBoardRow } from "./types";

// The 9110835499 shape: one invoice split 60 / 40 tins onto two truck parts
// (1,200 L and 800 L), bill to Shree Aaiji Hardware (c:2441).
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
  isHeld: false,
  heldAt: null,
  heldById: null,
  ci: null,
  isDispatched: false,
  loadRootId: 46099,
  shipTo,
});

const row = (part2: InvoiceShipTo): FloorBoardRow =>
  ({
    orderId: 25130,
    obdNumber: "9110835499",
    dealerName: OBD_SHIP.dealerName,
    isShipToOverride: false,
    shipToOverrideName: null,
    customerName: OBD_SHIP.dealerName,
    area: OBD_SHIP.area,
    deliveryType: OBD_SHIP.deliveryType,
    stopKey: OBD_SHIP.stopKey,
    smuCode: "70",
    billToName: null,
    isKeyCustomer: false,
    isTint: false,
    volumeLitres: 2000,
    weightKg: 2600,
    invoiceRows: [inv(46099, 1, 1200, OBD_SHIP), inv(46100, 2, 800, part2)],
    invoicePartners: [],
    invoiceNo: "I536299999",
  }) as unknown as FloorBoardRow;

test("every part inheriting (all live data): the SAME row object, one block", () => {
  const r = row(OBD_SHIP);
  const out = expandByShop([r]);
  assert.equal(out.length, 1);
  assert.equal(out[0], r);
  const bands = buildDivisionBands([r], () => false);
  assert.equal(bands.length, 1);
  assert.equal(bands[0].blocks.length, 1);
  assert.equal(bands[0].blocks[0].key, "c:2441");
});

test("part 2 → dealer 2375: two blocks, 1,200 L and 800 L, each named by its part", () => {
  const bands = buildDivisionBands([row(PART2_OWN)], () => false);
  assert.equal(bands.length, 1);
  const blocks = bands[0].blocks;
  assert.equal(blocks.length, 2);
  const byKey = new Map(blocks.map((b) => [b.key, b]));
  const a = byKey.get("c:2441")!;
  const b = byKey.get("c:2375")!;
  assert.equal(a.name, "Shree Aaiji Hardware");
  assert.equal(b.name, "National Hardware Paints");
  assert.equal(a.isRedirect, false);
  assert.equal(b.isRedirect, true);
  assert.deepEqual(a.rows.map((r) => [r.orderId, r.volumeLitres, r.invoiceRows.map((i) => i.id)]), [[25130, 1200, [46099]]]);
  assert.deepEqual(b.rows.map((r) => [r.orderId, r.volumeLitres, r.invoiceRows.map((i) => i.id)]), [[25130, 800, [46100]]]);
  // Both keep the OBD's full list for k / n.
  assert.equal(b.rows[0].invoiceRowsAll?.length, 2);
});
