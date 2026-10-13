// scripts/parity-oi-p5-1-20261013.ts — READ-ONLY parity for Add invoices
// Phase 5 commit 1 (per-invoice trip data + totals, no UI change). SELECTs only.
//
//   npx tsx scripts/parity-oi-p5-1-20261013.ts snapshot <file.json>   (OLD code)
//   npx tsx scripts/parity-oi-p5-1-20261013.ts compare <file.json>    (NEW code)
//
// Trips = every non-cancelled trip dated in the last 14 days + every live trip
// (draft / released / loading), whatever its date. For each, the numbers P5-1
// may move, OLD vs NEW:
//   · trip summary (lib/trips/queries.ts getTripSummariesByIds): counts, litres,
//     kg, unknown-kg count, stops;
//   · trip detail stops (getTripDetail): per stop bills, litres, order ids;
//   · billing Print (lib/billing/print.ts loadPrintTrips): bills, stops, litres,
//     eligible / copied, each bill's litres;
//   · trip sheet (lib/trip-sheet/load.ts getTripSheet): totals + each bill's litres / kg;
//   · load plan v2 (runLoadPlanV2 over today's Upcountry bills, on trips included)
//     and the day check (loadDayCheck) for each of the last 14 days with a snapshot.
// Plus (NEW code only) a SYNTHETIC in-memory check: order 18648 as if 713 + 715
// sat on one stop → 460 L and 356.33 + 270.30 kg (lib/floor/invoice-rows.ts placeLoad).
//
// Last line: PARITY OK or PARITY FAILED.

import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "fs";

const prisma = new PrismaClient();
const mode = process.argv[2] ?? "";
const file = process.argv[3] ?? "";
let failures = 0;
const fail = (m: string) => {
  failures++;
  console.log("  ✖ " + m);
};
const r3 = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n * 1000) / 1000);

(async () => {
  const { getTripSummariesByIds, getTripDetail } = await import("../lib/trips/queries");
  const { loadPrintTrips } = await import("../lib/billing/print");
  const { getTripSheet } = await import("../lib/trip-sheet/load");
  const { runLoadPlanV2 } = await import("../lib/floor/load-plan-v2-run");
  const { loadDayCheck } = await import("../lib/floor/load-plan-check-data");
  const { upcountryDayBillIds } = await import("../lib/floor/load-plan-snapshot");
  const { getTodayIST } = await import("../lib/dates");

  const today = getTodayIST();
  const dayMinus = (n: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const from = new Date(`${dayMinus(14)}T00:00:00Z`);
  const trips = await prisma.trips.findMany({
    where: {
      status: { not: "cancelled" },
      OR: [{ tripDate: { gte: from } }, { status: { in: ["draft", "released", "loading"] } }],
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const ids = trips.map((t) => t.id);
  console.log(`trips in scope: ${ids.length}`);

  const dump: Record<string, unknown> = {};
  const summaries = await getTripSummariesByIds(ids);
  for (const s of summaries) {
    dump[`summary ${s.id}`] = { counts: s.counts, litres: r3(s.totalLitres), kg: r3(s.totalWeightKg), unknownKg: s.weightUnknownCount, stops: s.dropCount };
  }
  for (const id of ids) {
    const d = await getTripDetail(id);
    if (!d) continue;
    dump[`detail ${id}`] = d.drops.map((x) => ({ id: x.id, bills: x.bills, litres: r3(x.litres), orderIds: x.orderIds }));
  }
  const print = await loadPrintTrips(ids);
  for (const p of print) {
    dump[`print ${p.id}`] = {
      bills: p.bills,
      stops: p.stops,
      litres: r3(p.litres),
      eligible: p.eligible,
      copied: p.copiedCount,
      rows: p.rows.map((r) => ({ id: r.orderId, litres: r3(r.litres), state: r.state })),
    };
  }
  for (const id of ids) {
    const sh = await getTripSheet(id);
    if (!sh) continue;
    dump[`sheet ${id}`] = {
      totals: { ...sh.totals, litres: r3(sh.totals.litres), kg: r3(sh.totals.kg) },
      bills: sh.stops.flatMap((s) => s.bills.map((b) => ({ id: b.orderId, litres: r3(b.litres), kg: r3(b.kg), redel: b.redel }))),
    };
  }
  const dayIds = await upcountryDayBillIds();
  const v2 = await runLoadPlanV2({ orderIds: dayIds, includeOnTrips: true });
  dump["load plan v2"] = JSON.parse(JSON.stringify(v2.plan ?? null), (_k, v) => (typeof v === "number" ? r3(v) : v));
  for (let n = 0; n <= 14; n++) {
    const day = dayMinus(n);
    try {
      const c = await loadDayCheck(day);
      dump[`day check ${day}`] = JSON.parse(JSON.stringify(c?.check ?? null), (_k, v) => (typeof v === "number" ? r3(v) : v));
    } catch (e) {
      dump[`day check ${day}`] = `error ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  console.log(`dumped ${Object.keys(dump).length} entries · summaries ${summaries.length} · print ${print.length}`);

  if (mode === "snapshot") {
    writeFileSync(file, JSON.stringify(dump));
    console.log(`snapshot written → ${file}`);
  } else if (mode === "compare") {
    const old = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const keys = Array.from(new Set([...Object.keys(old), ...Object.keys(dump)])).sort();
    let diff = 0;
    for (const k of keys) {
      if (JSON.stringify(old[k]) !== JSON.stringify(dump[k])) {
        diff++;
        if (diff <= 10) fail(`${k}: old ${String(JSON.stringify(old[k])).slice(0, 220)} · new ${String(JSON.stringify(dump[k])).slice(0, 220)}`);
      }
    }
    console.log(`compare: ${keys.length} entries · differing ${diff}`);
    if (diff > 10) fail(`… ${diff} differing in all`);
  }

  // ── Synthetic (NEW code only): 18648 as if 713 + 715 sat on one stop ───────
  const ir = (await import("../lib/floor/invoice-rows")) as Record<string, unknown>;
  const placeLoad = ir.placeLoad as
    | ((rows: Array<{ tripDropId: number | null; litres: number; kg: number | null; kgExact: boolean; tins: number }>, inPlace: (d: number | null) => boolean) => { litres: number; kg: number | null; kgExact: boolean; tins: number; invoices: number } | null)
    | undefined;
  if (placeLoad) {
    const { getFloorBoard } = await import("../lib/floor/queries");
    const b = await getFloorBoard({ mode: "live", onlyIds: [18648] });
    const row = b.rows.find((r) => r.orderId === 18648);
    if (!row) fail("18648 not on the live board");
    else {
      const STOP = 999999;
      const fake = row.invoiceRows.map((r) => ({ ...r, tripDropId: r.seq === 2 || r.seq === 4 ? STOP : null }));
      const onStop = placeLoad(fake, (d) => d === STOP);
      const offTrip = placeLoad(fake, (d) => d === null);
      const whole = placeLoad(row.invoiceRows as never, (d) => d === null);
      console.log(`synthetic 18648, 713 + 715 on one stop: ${JSON.stringify(onStop)}`);
      console.log(`synthetic 18648, the rest (716 + 714) in To plan: ${JSON.stringify(offTrip)}`);
      console.log(`18648 as it is (all 4 in To plan): ${JSON.stringify(whole)} (null = use the OBD's own totals)`);
      if (!onStop || r3(onStop.litres) !== 460 || r3(onStop.kg) !== r3(356.33 + 270.3) || !onStop.kgExact || onStop.invoices !== 2 || onStop.tins !== 23)
        fail("synthetic on-stop load is not 460 L / 626.63 kg / 2 invoices / 23 tins");
      if (!offTrip || r3(offTrip.litres) !== 540 || offTrip.invoices !== 2) fail("synthetic off-trip load is not 540 L / 2 invoices");
      if (whole !== null) fail("an OBD wholly in one place must use its own totals (null)");
    }
  } else if (mode !== "snapshot") {
    fail("placeLoad missing — synthetic check not run");
  }

  console.log(failures === 0 ? "\nPARITY OK — 0 differences" : `\nPARITY FAILED — ${failures} problem(s)`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
