// lib/order-invoices/trip-bills.test.ts — npx tsx --test lib/order-invoices/trip-bills.test.ts
//
// Phase 5 commit 2: which invoice rows a trip add / remove press moves. Pure.
// Fixture: order 18648 (OBD 9109951956) — rows 17010 …716 (seq 1), 36798 …713,
// 36799 …714, 36800 …715. Trip 668 = L-261007-20 (stop 2763, dropKey "C:1");
// trip 605 = L-261006-05 (stop 2478).

import test from "node:test";
import assert from "node:assert/strict";
import { foreignRowIds, invoiceLabel, moveRefusals, planAddRows, planRemoveRows, type TripBillRow } from "./trip-bills";

const OBD = "9109951956";
const KEY = "C:1";
const ON_668 = { tripDropId: 2763, tripId: 668, dropKey: KEY, tripNumber: "L-261007-20" };
const ON_605 = { tripDropId: 2478, tripId: 605, dropKey: KEY, tripNumber: "L-261006-05" };
const OFF = { tripDropId: null, tripId: null, dropKey: null, tripNumber: null };

const r18648 = (places: (typeof OFF | typeof ON_668 | typeof ON_605)[]): TripBillRow[] =>
  [
    [17010, "I536230716"],
    [36798, "I536230713"],
    [36799, "I536230714"],
    [36800, "I536230715"],
  ].map(([id, no], i) => ({ id: id as number, seq: i + 1, invoiceNo: no as string, ...places[i] }));

const unsplit = (place: typeof OFF | typeof ON_668 | typeof ON_605): TripBillRow[] => [
  { id: 500, seq: 1, invoiceNo: "I1", ...place },
];

// ── add ──────────────────────────────────────────────────────────────────────

test("add, unsplit OBD off any trip: attaches its one row", () => {
  assert.deepEqual(planAddRows(unsplit(OFF), "all", 668, KEY, OBD), { attach: [500], here: [], refused: [] });
});

test("add, unsplit OBD on another trip: today's wording, word for word", () => {
  assert.deepEqual(planAddRows(unsplit(ON_605), "all", 668, KEY, OBD).refused, [
    { rowId: 500, invoiceNo: "I1", error: "Already on L-261006-05 — remove it from that trip first." },
  ]);
});

test("add, unsplit OBD already at its stop on this trip: nothing to do", () => {
  assert.deepEqual(planAddRows(unsplit(ON_668), "all", 668, KEY, OBD), { attach: [], here: [500], refused: [] });
});

test("add, a different stop on this trip: refused with today's wording", () => {
  assert.deepEqual(planAddRows(unsplit(ON_668), "all", 668, "C:2", OBD).refused[0].error, "Already attached to a different stop on this trip.");
});

test("add PARTIAL: only the chosen invoices (713 + 715) attach", () => {
  const plan = planAddRows(r18648([OFF, OFF, OFF, OFF]), [36798, 36800], 668, KEY, OBD);
  assert.deepEqual(plan, { attach: [36798, 36800], here: [], refused: [] });
});

test("add whole split OBD, one invoice on ANOTHER trip: refused for that invoice only, the rest attach", () => {
  const plan = planAddRows(r18648([OFF, ON_605, OFF, OFF]), "all", 668, KEY, OBD);
  assert.deepEqual(plan.attach, [17010, 36799, 36800]);
  assert.deepEqual(plan.refused, [
    { rowId: 36798, invoiceNo: "I536230713", error: "I536230713 is already on L-261006-05 — remove it from that trip first" },
  ]);
});

test("add whole split OBD, some invoices already here: the rest join the SAME stop", () => {
  const plan = planAddRows(r18648([OFF, ON_668, OFF, ON_668]), "all", 668, KEY, OBD);
  assert.deepEqual(plan, { attach: [17010, 36799], here: [36798, 36800], refused: [] });
});

test("add: a split row with no invoice number is named by its place", () => {
  const rows = r18648([OFF, ON_605, OFF, OFF]).map((r) => (r.seq === 2 ? { ...r, invoiceNo: null } : r));
  assert.equal(planAddRows(rows, "all", 668, KEY, OBD).refused[0].error, `Invoice 2 of ${OBD} is already on L-261006-05 — remove it from that trip first`);
  assert.equal(invoiceLabel({ seq: 3, invoiceNo: "I9" }, OBD), "I9");
});

// ── remove ───────────────────────────────────────────────────────────────────

test("remove, unsplit OBD on this trip: its row comes off, its stop is checked", () => {
  assert.deepEqual(planRemoveRows(unsplit(ON_668), "all", 668, OBD), { detach: [500], dropIds: [2763], refused: [] });
});

test("remove, whole OBD: ONLY rows on this trip — another trip's invoice stays", () => {
  const plan = planRemoveRows(r18648([ON_605, ON_668, OFF, ON_668]), "all", 668, OBD);
  assert.deepEqual(plan, { detach: [36798, 36800], dropIds: [2763], refused: [] });
});

test("remove PARTIAL: only the chosen invoice comes off", () => {
  const plan = planRemoveRows(r18648([OFF, ON_668, OFF, ON_668]), [36800], 668, OBD);
  assert.deepEqual(plan, { detach: [36800], dropIds: [2763], refused: [] });
});

test("remove: a chosen invoice not on this trip is refused for that invoice", () => {
  const plan = planRemoveRows(r18648([OFF, ON_668, OFF, ON_605]), [36798, 36800], 668, OBD);
  assert.deepEqual(plan.detach, [36798]);
  assert.deepEqual(plan.refused, [{ rowId: 36800, invoiceNo: "I536230715", error: "I536230715 is not on this trip" }]);
});

test("remove, whole OBD with nothing on this trip: nothing to detach, nothing refused (the route says 'Not on this trip')", () => {
  assert.deepEqual(planRemoveRows(unsplit(ON_605), "all", 668, OBD), { detach: [], dropIds: [], refused: [] });
});

// ── foreign ids ──────────────────────────────────────────────────────────────

test("chosen ids that are not this OBD's rows are reported", () => {
  assert.deepEqual(foreignRowIds(r18648([OFF, OFF, OFF, OFF]), [36798, 99]), [99]);
  assert.deepEqual(foreignRowIds(r18648([OFF, OFF, OFF, OFF]), "all"), []);
});

// ── 6.3: a held / CI'd invoice never joins a trip ───────────────────────────

test("add: a HELD invoice of a split OBD is refused for that invoice only; the rest attach", () => {
  const rows = r18648([OFF, OFF, OFF, OFF]).map((r) => ({ ...r, isHeld: r.id === 17010 || r.id === 36799 }));
  const plan = planAddRows(rows, "all", 668, KEY, OBD);
  assert.deepEqual(plan.attach, [36798, 36800]);
  assert.deepEqual(
    plan.refused.map((x) => x.error),
    ["I536230716 is on hold — release it first", "I536230714 is on hold — release it first"],
  );
  // Ticking only 716 writes nothing.
  const one = planAddRows(rows, [17010], 668, KEY, OBD);
  assert.deepEqual(one.attach, []);
  assert.deepEqual(one.refused.map((x) => x.rowId), [17010]);
});

test("add: an invoice with its own CI is refused; an unsplit held bill keeps today's rule", () => {
  const rows = r18648([OFF, OFF, OFF, OFF]).map((r) => ({ ...r, ciNumber: r.id === 36798 ? "CI-2026-00700" : null }));
  const plan = planAddRows(rows, [36798, 36800], 668, KEY, OBD);
  assert.deepEqual(plan.attach, [36800]);
  assert.deepEqual(plan.refused.map((x) => x.error), ["I536230713 is returned on CI-2026-00700 — it does not go out"]);
  const held = unsplit(OFF).map((r) => ({ ...r, isHeld: true }));
  assert.deepEqual(planAddRows(held, "all", 668, KEY, "X").attach, [500]);
});

// ── Split load (2026-10-24): one part of an invoice per trip ────────────────

/** 18648 split by load: 17010 …716 (root) + parts 40001, 40002 — all the same number. */
const loadRows = (places: (typeof OFF | typeof ON_668 | typeof ON_605)[]): TripBillRow[] =>
  [17010, 40001, 40002].map((id, i) => ({ id, seq: i + 1, invoiceNo: "I536230716", loadRootId: 17010, ...places[i] }));

test("split load: a part is refused when another part of the SAME invoice is already on this trip", () => {
  const plan = planAddRows(loadRows([ON_668, OFF, ON_605]), [40001], 668, KEY, OBD);
  assert.deepEqual(plan.attach, []);
  assert.deepEqual(plan.refused, [
    { rowId: 40001, invoiceNo: "I536230716", error: "I536230716 part 2 of 3 — part 1 of the same invoice is already on this trip" },
  ]);
});

test("split load: two parts of one invoice in ONE press — the first attaches, the second is refused", () => {
  const plan = planAddRows(loadRows([ON_605, OFF, OFF]), "all", 668, KEY, OBD);
  assert.deepEqual(plan.attach, [40001]);
  assert.deepEqual(plan.refused.map((x) => x.error), [
    // Phase 4 batch 5 (F11): every label of a load part names it (was the bare number).
    "I536230716 part 1 of 3 is already on L-261006-05 — remove it from that trip first",
    "I536230716 part 3 of 3 — part 2 of the same invoice is already on this trip",
  ]);
});

test("split load: a part on its own on another trip's press attaches", () => {
  assert.deepEqual(planAddRows(loadRows([ON_605, OFF, OFF]), [40002], 668, KEY, OBD).attach, [40002]);
});

test("split load: rows WITHOUT loadRootId keep every wording byte for byte (null and absent alike)", () => {
  for (const extra of [{}, { loadRootId: null }]) {
    const u = unsplit(ON_605).map((r) => ({ ...r, ...extra }));
    assert.deepEqual(planAddRows(u, "all", 668, KEY, OBD).refused, [
      { rowId: 500, invoiceNo: "I1", error: "Already on L-261006-05 — remove it from that trip first." },
    ]);
    assert.equal(planAddRows(unsplit(ON_668).map((r) => ({ ...r, ...extra })), "all", 668, "C:2", OBD).refused[0].error, "Already attached to a different stop on this trip.");
    assert.deepEqual(planAddRows(unsplit(OFF).map((r) => ({ ...r, ...extra })), "all", 668, KEY, OBD), { attach: [500], here: [], refused: [] });
    const split = r18648([OFF, ON_605, OFF, OFF]).map((r) => ({ ...r, ...extra }));
    assert.deepEqual(planAddRows(split, "all", 668, KEY, OBD).attach, [17010, 36799, 36800]);
  }
});

// ── Split load, Phase 4 batch 1 (2026-10-25): a MOVE is a join too ──────────

test("move: a part moved onto the trip holding another part of the invoice is refused — that part only", () => {
  // I536233980-shaped: part 1 on 605, part 2 on 668; move part 1 from 605 to 668.
  const rows = loadRows([ON_605, ON_668, OFF]);
  const detach = planRemoveRows(rows, [17010], 605, OBD).detach;
  assert.deepEqual(detach, [17010]);
  assert.deepEqual(moveRefusals(rows, detach, 668, OBD), {
    move: [],
    refused: [{ rowId: 17010, invoiceNo: "I536230716", error: "I536230716 part 1 of 3 — part 2 of the same invoice is already on this trip" }],
  });
  // Onto a trip with no other part → it moves.
  assert.deepEqual(moveRefusals(loadRows([ON_605, OFF, OFF]), [17010], 668, OBD), { move: [17010], refused: [] });
});

test("move: unsplit and Add-invoices rows always move, as before", () => {
  for (const extra of [{}, { loadRootId: null }]) {
    const u = unsplit(ON_605).map((r) => ({ ...r, ...extra }));
    assert.deepEqual(moveRefusals(u, [500], 668, OBD), { move: [500], refused: [] });
    const split = r18648([ON_605, ON_668, ON_605, OFF]).map((r) => ({ ...r, ...extra }));
    assert.deepEqual(moveRefusals(split, [17010, 36799], 668, OBD), { move: [17010, 36799], refused: [] });
  }
});
