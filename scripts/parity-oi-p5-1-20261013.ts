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
// --since=Nd (P5-2, 2026-10-15): N days instead of 14, for the trips and the
// day checks. Live trips are always in.
//
// Last line: PARITY OK or PARITY FAILED.

import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "fs";

const prisma = new PrismaClient();
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const mode = positional[0] ?? "";
const file = positional[1] ?? "";
const sinceArg = process.argv.find((a) => a.startsWith("--since="));
const SINCE_DAYS = sinceArg ? Number(sinceArg.slice("--since=".length).replace(/d$/, "")) : null;
if (SINCE_DAYS !== null && !(Number.isInteger(SINCE_DAYS) && SINCE_DAYS > 0)) throw new Error(`bad ${sinceArg}`);
const DAYS = SINCE_DAYS ?? 14;
// --scope=<file> (P5-2): the frozen trip set from scripts/parity-oi-scope-p5-2.ts —
// replaces the trip query below (813 of 858 trips are draft / released, so
// "live" by status is the whole history).
const scopeArg = process.argv.find((a) => a.startsWith("--scope="));
const SCOPE_IDS: number[] | null = scopeArg
  ? (JSON.parse(readFileSync(scopeArg.slice("--scope=".length), "utf8")) as { ids: number[] }).ids
  : null;
let failures = 0;
const fail = (m: string) => {
  failures++;
  console.log("  ✖ " + m);
};
// P5-2 (2026-10-15): the pooler resets connections mid-run (Windows 10054),
// and this run is ~40 min. Each read is retried on a CONNECTION error only
// (Prisma reconnects on the next query); any other error still throws.
const CONN_ERR = /P1017|P1001|Can't reach database server|Server has closed the connection|ConnectionReset|ECONNRESET/;
async function retry<T>(what: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt >= 5 || !CONN_ERR.test(msg)) throw e;
      console.log(`  ↻ ${what}: connection error, retry ${attempt}/4 in 5s`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
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
  const from = new Date(`${dayMinus(DAYS)}T00:00:00Z`);
  const trips = await retry("trips", () => prisma.trips.findMany({
    where:
      SCOPE_IDS !== null
        ? { status: { not: "cancelled" }, id: { in: SCOPE_IDS } }
        : { status: { not: "cancelled" }, OR: [{ tripDate: { gte: from } }, { status: { in: ["draft", "released", "loading"] } }] },
    select: { id: true },
    orderBy: { id: "asc" },
  }));
  const ids = trips.map((t) => t.id);
  console.log(`trips in scope: ${ids.length}`);

  const dump: Record<string, unknown> = {};
  const summaries = await retry("summaries", () => getTripSummariesByIds(ids));
  for (const s of summaries) {
    dump[`summary ${s.id}`] = { counts: s.counts, litres: r3(s.totalLitres), kg: r3(s.totalWeightKg), unknownKg: s.weightUnknownCount, stops: s.dropCount };
  }
  for (const id of ids) {
    const d = await retry(`detail ${id}`, () => getTripDetail(id));
    if (!d) continue;
    dump[`detail ${id}`] = d.drops.map((x) => ({ id: x.id, bills: x.bills, litres: r3(x.litres), orderIds: x.orderIds }));
  }
  const print = await retry("print", () => loadPrintTrips(ids));
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
    const sh = await retry(`sheet ${id}`, () => getTripSheet(id));
    if (!sh) continue;
    dump[`sheet ${id}`] = {
      totals: { ...sh.totals, litres: r3(sh.totals.litres), kg: r3(sh.totals.kg) },
      bills: sh.stops.flatMap((s) => s.bills.map((b) => ({ id: b.orderId, litres: r3(b.litres), kg: r3(b.kg), redel: b.redel }))),
    };
  }
  const dayIds = await retry("upcountry", () => upcountryDayBillIds());
  const v2 = await retry("load plan v2", () => runLoadPlanV2({ orderIds: dayIds, includeOnTrips: true }));
  dump["load plan v2"] = JSON.parse(JSON.stringify(v2.plan ?? null), (_k, v) => (typeof v === "number" ? r3(v) : v));
  for (let n = 0; n <= DAYS; n++) {
    const day = dayMinus(n);
    try {
      const c = await retry(`day check ${day}`, () => loadDayCheck(day));
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
    // With --scope the snapshot may cover MORE trips than this run (a wider
    // old-code snapshot): an old per-trip key whose trip is not in the scope is
    // OUT OF SCOPE — counted, never compared. Every other key is compared.
    const inScope = new Set((SCOPE_IDS ?? []).map(String));
    const tripKey = /^(summary|detail|print|sheet) (\d+)$/;
    let outOfScope = 0;
    const keys = Array.from(new Set([...Object.keys(old), ...Object.keys(dump)]))
      .filter((k) => {
        const m = tripKey.exec(k);
        if (SCOPE_IDS !== null && m && !inScope.has(m[2]) && !(k in dump)) {
          outOfScope++;
          return false;
        }
        return true;
      })
      .sort();
    let diff = 0;
    const differing: string[] = [];
    for (const k of keys) {
      if (JSON.stringify(old[k]) !== JSON.stringify(dump[k])) {
        diff++;
        differing.push(k);
        if (diff <= 10) fail(`${k}: old ${String(JSON.stringify(old[k])).slice(0, 220)} · new ${String(JSON.stringify(dump[k])).slice(0, 220)}`);
      }
    }
    console.log(`compare: ${keys.length} entries · differing ${diff} · old-only out of --scope (not compared) ${outOfScope}`);
    if (differing.length > 0) console.log(`differing keys: ${differing.join(" | ")}`);
    if (diff > 10) fail(`… ${diff} differing in all`);
    // Kept so every difference can be itemised afterwards.
    writeFileSync(`${file}.new.json`, JSON.stringify(dump));
    console.log(`this run's dump → ${file}.new.json`);
  }

  // ── Synthetic (NEW code only): 18648 as if 713 + 715 sat on one stop ───────
  const ir = (await import("../lib/floor/invoice-rows")) as Record<string, unknown>;
  const placeLoad = ir.placeLoad as
    | ((rows: Array<{ tripDropId: number | null; litres: number; kg: number | null; kgExact: boolean; tins: number }>, inPlace: (d: number | null) => boolean) => { litres: number; kg: number | null; kgExact: boolean; tins: number; invoices: number } | null)
    | undefined;
  if (placeLoad) {
    const { getFloorBoard } = await import("../lib/floor/queries");
    const b = await retry("board 18648", () => getFloorBoard({ mode: "live", onlyIds: [18648] }));
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
