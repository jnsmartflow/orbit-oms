// scripts/parity-oi-readers-b-20261012.ts — READ-ONLY parity for Add invoices
// Phase 3 readers B (Floor board, picking gate, billing print, load plan).
// SELECTs only; writes nothing. Sibling of scripts/parity-oi-trips-20261012.ts,
// reused by readers C.
//
//   npx tsx scripts/parity-oi-readers-b-20261012.ts snapshot <file.json>
//       run on the OLD code: dumps what the real functions return.
//   npx tsx scripts/parity-oi-readers-b-20261012.ts compare <file.json>
//       run on the NEW code: the same dump, diffed against the file.
//   npx tsx scripts/parity-oi-readers-b-20261012.ts
//       no file: only the code-independent checks and the EXPLAINs.
//
// Code-independent checks (old orders."tripDropId" predicate vs the invoice
// rows, computed here, whatever the code says):
//   · picking: the gate-ON visible waiting set, held-back bills / trucks, and
//     the waiting + total count per trip (lib/trips/show.ts's numbers);
//   · Floor: each live / History row's trip label = the trip of its OBD's
//     lowest-seq row on a stop, and isAwaitingShow = "waiting and no row on a
//     shown trip";
//   · print: the bill set per trip for trips dated in the last 7 days, and the
//     raw work-trip list.
// EXPLAIN (text): getFloorBoard's main query (live + one History day), the
// picking queue query with the gate ON, and the held-back count (every query of
// that read). compare fails on a NEW "Seq Scan on orders" or a LOST index.
//
// --since=Nd (P5-2, 2026-10-15): the per-trip code-independent counts cover only
// trips dated in the last N days plus every live trip (draft / released); the
// Print week is the last N days. Omitted = as before (all trips, 7 days). P5-2
// also EXPLAINs the Floor MARKER read (getFloorLiveMarkerWhere → the route's
// orders.aggregate) and compares its plan exactly like the board's.
//
// Last line: PARITY OK or PARITY FAILED.

import { PrismaClient, type Prisma } from "@prisma/client";
import { readFileSync, writeFileSync } from "fs";

// Install a query-logging client as THE app client before any lib/ import.
const logged = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
let captured: { query: string; params: string }[] = [];
logged.$on("query", (e) => captured.push({ query: e.query, params: e.params }));
(globalThis as unknown as { prisma: PrismaClient }).prisma = logged;
const prisma = logged;

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const mode = positional[0] ?? "";
const file = positional[1] ?? "";
const sinceArg = process.argv.find((a) => a.startsWith("--since="));
const SINCE_DAYS = sinceArg ? Number(sinceArg.slice("--since=".length).replace(/d$/, "")) : null;
if (SINCE_DAYS !== null && !(Number.isInteger(SINCE_DAYS) && SINCE_DAYS > 0)) throw new Error(`bad ${sinceArg}`);
// --scope=<file> (P5-2): the frozen trip set from scripts/parity-oi-scope-p5-2.ts — wins over --since.
const scopeArg = process.argv.find((a) => a.startsWith("--scope="));
const SCOPE_IDS: number[] | null = scopeArg
  ? (JSON.parse(readFileSync(scopeArg.slice("--scope=".length), "utf8")) as { ids: number[] }).ids
  : null;
let failures = 0;
const fail = (msg: string) => {
  failures += 1;
  console.log("  ✖ " + msg);
};

function inline(query: string, params: string): string {
  const vals = JSON.parse(params) as unknown[];
  return query.replace(/\$(\d+)/g, (_m, n: string) => {
    const v = vals[Number(n) - 1];
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (v === null) return "NULL";
    return `'${String(v).replace(/'/g, "''")}'`;
  });
}

const plans: Record<string, { seqScanOrders: boolean; indexes: string[] }> = {};
// `all`: EXPLAIN every captured query the read made (a Prisma relation select
// is a follow-up query by id — its index use belongs to the same read), not
// just the longest one.
async function explainCaptured(label: string, pick: (q: { query: string }) => boolean, all = false) {
  const cands = captured.filter(pick).sort((a, b) => b.query.length - a.query.length);
  const qs = all ? cands : cands.slice(0, 1);
  if (qs.length === 0) {
    console.log(`\n--- EXPLAIN ${label}: no query captured`);
    return;
  }
  const lines: string[] = [];
  for (const q of qs) {
    const plan = await prisma.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN ${inline(q.query, q.params)}`);
    if (lines.length > 0) lines.push("  ·· next query of the same read ··");
    lines.push(...plan.map((r) => r["QUERY PLAN"]));
  }
  console.log(`\n--- EXPLAIN ${label} (${lines.length} lines) ---`);
  for (const l of lines) console.log("  " + l);
  // Recorded, not failed here: the History board already seq-scans orders on
  // the pre-change code (2026-10-12 baseline). compare fails on a NEW seq scan
  // or a LOST index against the snapshot.
  const seqScanOrders = lines.some((l) => /Seq Scan on orders\b/.test(l));
  const indexes = Array.from(
    new Set(lines.flatMap((l) => Array.from(l.matchAll(/(?:Index Scan|Index Only Scan|Bitmap Index Scan) (?:using|on) "?([A-Za-z_]+)"?/g)).map((m) => m[1]))),
  ).sort();
  plans[label] = { seqScanOrders, indexes };
  console.log(`  → Seq Scan on orders: ${seqScanOrders ? "YES" : "no"} · indexes: ${indexes.join(", ")}`);
}

const setEq = (a: Iterable<number | string>, b: Iterable<number | string>) => {
  const A = new Set(a);
  const B = new Set(b);
  const onlyA = Array.from(A).filter((x) => !B.has(x));
  const onlyB = Array.from(B).filter((x) => !A.has(x));
  return { ok: onlyA.length + onlyB.length === 0, onlyA, onlyB };
};

(async () => {
  const { getFloorBoard, getFloorLiveMarkerWhere } = await import("../lib/floor/queries");
  const { buildPickingWhere } = await import("../lib/picking/queue");
  const { countHeldBackWaiting, WAITING_FOR_PICKER } = await import("../lib/picking/visibility-gate");
  const { loadPrintTrips, getPrintWorkTripIds } = await import("../lib/billing/print");
  const { upcountryDayBillIds } = await import("../lib/floor/load-plan-snapshot");
  const { getTodayIST } = await import("../lib/dates");
  const { BILLABLE_BILL_WHERE } = await import("../lib/challan-orders/where");

  const today = getTodayIST();
  const dayMinus = (n: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const historyDays = [1, 2, 3].map(dayMinus);

  // ── The dump of the real functions (snapshot / compare) ───────────────────
  type BoardDump = Record<string, { orderId: number; tripDropId: number | null; tripNumber: string | null; isAwaitingShow: boolean }[]>;
  const boards: BoardDump = {};
  captured = [];
  const live = await getFloorBoard({ mode: "live" });
  boards["live " + today] = live.rows.map((r) => ({ orderId: r.orderId, tripDropId: r.tripDropId, tripNumber: r.tripNumber, isAwaitingShow: r.isAwaitingShow }));
  await explainCaptured("Floor board LIVE main query", (c) => /FROM "public"\."orders"/.test(c.query) && /WHERE/.test(c.query) && /OR/.test(c.query));
  for (const d of historyDays) {
    captured = [];
    const h = await getFloorBoard({ mode: "history", date: d });
    boards["history " + d] = h.rows.map((r) => ({ orderId: r.orderId, tripDropId: r.tripDropId, tripNumber: r.tripNumber, isAwaitingShow: r.isAwaitingShow }));
    if (d === historyDays[0]) {
      await explainCaptured(`Floor board HISTORY ${d} main query`, (c) => /FROM "public"\."orders"/.test(c.query) && /WHERE/.test(c.query) && /OR/.test(c.query));
    }
  }

  // The Floor MARKER — the route's exact read (app/api/floor/marker/route.ts).
  captured = [];
  const markerAgg = await prisma.orders.aggregate({ where: await getFloorLiveMarkerWhere(), _count: true, _max: { updatedAt: true } });
  await explainCaptured("Floor marker (live where, aggregate)", (c) => /FROM "public"\."orders"/.test(c.query) && /WHERE/.test(c.query));
  const marker = { count: markerAgg._count, latest: markerAgg._max.updatedAt?.toISOString() ?? null };

  const ungated = buildPickingWhere({ scope: "openPending" }).where;
  const gated = buildPickingWhere({ scope: "openPending", gateOn: true }).where;
  captured = [];
  const visible = (await prisma.orders.findMany({ where: gated, select: { id: true } })).map((o) => o.id).sort((a, b) => a - b);
  await explainCaptured("Picking queue (openPending, gate ON)", (c) => /FROM "public"\."orders"/.test(c.query));
  captured = [];
  const heldBack = await countHeldBackWaiting(ungated, true);
  await explainCaptured("Picking held-back (trip-held bills)", (c) => /^SELECT/.test(c.query) && !/COUNT/i.test(c.query) && !/app_settings/.test(c.query), true);

  const weekTrips = await prisma.trips.findMany({
    where: { tripDate: { gte: new Date(`${dayMinus(SINCE_DAYS ?? 7)}T00:00:00Z`) }, status: { not: "cancelled" } },
    select: { id: true, tripNumber: true },
  });
  const print = await loadPrintTrips(weekTrips.map((t) => t.id));
  const printDump = Object.fromEntries(print.map((t) => [t.id, { bills: t.bills, stops: t.stops, orderIds: t.rows.map((r) => r.orderId).sort((a, b) => a - b) }]));
  const workTrips = (await getPrintWorkTripIds()).sort((a, b) => a - b);
  const upcountry = (await upcountryDayBillIds()).sort((a, b) => a - b);

  const dump = { boards, visible, heldBack, printDump, workTrips, upcountry, plans, marker };
  console.log(
    `\nDUMP: live rows ${boards["live " + today].length} · history ${historyDays.map((d) => `${d}=${boards["history " + d].length}`).join(" ")} · ` +
      `picking visible ${visible.length} · held back ${JSON.stringify(heldBack)} · print trips ${print.length} · work trips ${workTrips.length} · upcountry ${upcountry.length}`,
  );

  if (mode === "snapshot") {
    writeFileSync(file, JSON.stringify(dump));
    console.log(`snapshot written: ${file}`);
  } else if (mode === "compare") {
    console.log(`\n=== COMPARE with ${file} ===`);
    const old = JSON.parse(readFileSync(file, "utf8")) as typeof dump;
    for (const k of Object.keys(old.boards)) {
      const a = old.boards[k];
      const b = dump.boards[k] ?? [];
      const ka = a.map((r) => JSON.stringify(r));
      const kb = b.map((r) => JSON.stringify(r));
      const r = setEq(ka, kb);
      console.log(`board ${k}: old ${a.length} · new ${b.length} · ${r.ok ? "same" : "DIFFERENT"}`);
      if (!r.ok) fail(`board ${k}: only old ${r.onlyA.slice(0, 5)} · only new ${r.onlyB.slice(0, 5)}`);
    }
    const v = setEq(old.visible, dump.visible);
    console.log(`picking visible: old ${old.visible.length} · new ${dump.visible.length} · ${v.ok ? "same" : "DIFFERENT"}`);
    if (!v.ok) fail(`picking visible only old ${v.onlyA} only new ${v.onlyB}`);
    const hb = JSON.stringify(old.heldBack) === JSON.stringify(dump.heldBack);
    console.log(`held back: old ${JSON.stringify(old.heldBack)} · new ${JSON.stringify(dump.heldBack)} · ${hb ? "same" : "DIFFERENT"}`);
    if (!hb) fail("held back differs");
    const pk = setEq(Object.keys(old.printDump), Object.keys(dump.printDump));
    let printDiff = 0;
    for (const id of Object.keys(old.printDump)) {
      if (JSON.stringify(old.printDump[id]) !== JSON.stringify(dump.printDump[id])) {
        printDiff += 1;
        fail(`print trip ${id}: old ${JSON.stringify(old.printDump[id])} new ${JSON.stringify(dump.printDump[id])}`);
      }
    }
    console.log(`print trips: ${Object.keys(old.printDump).length} · trips differing ${printDiff} · trip set ${pk.ok ? "same" : "DIFFERENT"}`);
    if (!pk.ok) fail("print trip set differs");
    const w = setEq(old.workTrips, dump.workTrips);
    console.log(`print work trips: old ${old.workTrips.length} · new ${dump.workTrips.length} · ${w.ok ? "same" : "DIFFERENT"}`);
    if (!w.ok) fail(`work trips only old ${w.onlyA} only new ${w.onlyB}`);
    for (const [label, p] of Object.entries(dump.plans)) {
      const o = old.plans?.[label];
      if (!o) continue;
      const lost = o.indexes.filter((i) => !p.indexes.includes(i));
      const gained = p.indexes.filter((i) => !o.indexes.includes(i));
      console.log(`plan ${label}: seq scan on orders ${o.seqScanOrders ? "yes" : "no"} → ${p.seqScanOrders ? "yes" : "no"} · indexes lost [${lost}] · gained [${gained}]`);
      if (p.seqScanOrders && !o.seqScanOrders) fail(`${label}: NEW Seq Scan on orders`);
      if (lost.length > 0) fail(`${label}: lost index ${lost}`);
    }
    console.log(`marker: old ${JSON.stringify(old.marker ?? null)} · new ${JSON.stringify(dump.marker)} (informational — moves with live data)`);
    const u = setEq(old.upcountry, dump.upcountry);
    console.log(`load plan upcountry day bills: old ${old.upcountry.length} · new ${dump.upcountry.length} · ${u.ok ? "same" : "DIFFERENT"}`);
    if (!u.ok) fail(`upcountry only old ${u.onlyA} only new ${u.onlyB}`);
  }

  // ── Code-independent: old orders predicate vs the rows ────────────────────
  console.log("\n=== OLD predicate vs invoice rows (code-independent) ===");
  const shownRow: Prisma.ordersWhereInput = { invoices: { some: { tripDrop: { trip: { shownAt: { not: null } } } } } };
  const oldVisible = await prisma.orders.findMany({
    where: { ...WAITING_FOR_PICKER, tripDropId: { not: null }, tripDrop: { trip: { shownAt: { not: null } } } },
    select: { id: true },
  });
  const newVisible = await prisma.orders.findMany({ where: { ...WAITING_FOR_PICKER, ...shownRow }, select: { id: true } });
  const vv = setEq(oldVisible.map((o) => o.id), newVisible.map((o) => o.id));
  console.log(`waiting on a SHOWN trip: old ${oldVisible.length} · rows ${newVisible.length} · ${vv.ok ? "same" : "DIFFERENT"}`);
  if (!vv.ok) fail(`visible only old ${vv.onlyA} only rows ${vv.onlyB}`);

  // Per trip: waiting + total (show.ts), and held-back trucks.
  const tripScope: Prisma.tripsWhereInput =
    SCOPE_IDS !== null
      ? { status: { not: "cancelled" }, id: { in: SCOPE_IDS } }
      : SINCE_DAYS === null
        ? { status: { not: "cancelled" } }
        : { status: { not: "cancelled" }, tripDate: { gte: new Date(`${dayMinus(SINCE_DAYS)}T00:00:00Z`) } };
  const drops = await prisma.trip_drops.findMany({ where: { trip: tripScope }, select: { id: true, tripId: true } });
  const tripOf = new Map(drops.map((d) => [d.id, d.tripId]));
  const perTrip = async (useRows: boolean, extra: Prisma.ordersWhereInput) => {
    const m = new Map<number, number>();
    if (!useRows) {
      const rows = await prisma.orders.findMany({ where: { ...extra, tripDropId: { in: Array.from(tripOf.keys()) } }, select: { tripDropId: true } });
      for (const r of rows) m.set(tripOf.get(r.tripDropId!)!, (m.get(tripOf.get(r.tripDropId!)!) ?? 0) + 1);
    } else {
      const rows = await prisma.order_invoices.findMany({
        where: { tripDropId: { in: Array.from(tripOf.keys()) }, order: extra },
        select: { orderId: true, tripDropId: true },
      });
      const seen = new Set<string>();
      for (const r of rows) {
        const t = tripOf.get(r.tripDropId!)!;
        const k = `${t}:${r.orderId}`;
        if (seen.has(k)) continue;
        seen.add(k);
        m.set(t, (m.get(t) ?? 0) + 1);
      }
    }
    return m;
  };
  for (const [label, extra] of [
    ["waiting per trip (show.ts)", WAITING_FOR_PICKER],
    ["total per trip (show.ts)", { isRemoved: false }],
  ] as const) {
    const a = await perTrip(false, extra);
    const b = await perTrip(true, extra);
    const keys = Array.from(new Set([...Array.from(a.keys()), ...Array.from(b.keys())]));
    const diff = keys.filter((k) => a.get(k) !== b.get(k));
    console.log(`${label}: trips ${keys.length} · differing ${diff.length}`);
    if (diff.length > 0) fail(`${label}: trips ${diff.slice(0, 10)}`);
  }

  // Floor labels and isAwaitingShow, recomputed from the rows for every board row.
  const allBoardIds = Array.from(new Set(Object.values(dump.boards).flatMap((rs) => rs.map((r) => r.orderId))));
  const inv = await prisma.order_invoices.findMany({
    where: { orderId: { in: allBoardIds }, tripDropId: { not: null } },
    select: { orderId: true, seq: true, tripDropId: true, tripDrop: { select: { trip: { select: { tripNumber: true, shownAt: true } } } } },
  });
  const ord = await prisma.orders.findMany({ where: { id: { in: allBoardIds } }, select: { id: true, workflowStage: true, dispatchStatus: true } });
  const ordById = new Map(ord.map((o) => [o.id, o]));
  const byOrder = new Map<number, typeof inv>();
  for (const r of inv) byOrder.set(r.orderId, [...(byOrder.get(r.orderId) ?? []), r]);
  let labelDiffs = 0;
  let awaitDiffs = 0;
  for (const [k, rows] of Object.entries(dump.boards)) {
    for (const r of rows) {
      const rs = (byOrder.get(r.orderId) ?? []).slice().sort((x, y) => x.seq - y.seq);
      const lowest = rs[0];
      const expectNo = lowest?.tripDrop?.trip.tripNumber ?? null;
      const expectDrop = lowest?.tripDropId ?? null;
      if (expectNo !== r.tripNumber || expectDrop !== r.tripDropId) {
        labelDiffs += 1;
        if (labelDiffs <= 5) fail(`${k} order ${r.orderId}: board ${r.tripDropId}/${r.tripNumber} rows ${expectDrop}/${expectNo}`);
      }
      const o = ordById.get(r.orderId);
      const waiting = o?.workflowStage === "pending_picking" && o?.dispatchStatus === "dispatch";
      const expectAwait = waiting && !rs.some((x) => x.tripDrop?.trip.shownAt != null);
      if (expectAwait !== r.isAwaitingShow) {
        awaitDiffs += 1;
        if (awaitDiffs <= 5) fail(`${k} order ${r.orderId}: isAwaitingShow board ${r.isAwaitingShow} rows ${expectAwait}`);
      }
    }
  }
  console.log(`Floor rows checked ${Object.values(dump.boards).reduce((s, rs) => s + rs.length, 0)} · label differs ${labelDiffs} · isAwaitingShow differs ${awaitDiffs}`);
  if (labelDiffs > 5 || awaitDiffs > 5) fail(`… ${labelDiffs} label / ${awaitDiffs} await diffs in all`);

  // Print: bill set per trip of the week, old predicate vs rows.
  const weekDrops = await prisma.trip_drops.findMany({ where: { tripId: { in: weekTrips.map((t) => t.id) } }, select: { id: true, tripId: true } });
  const weekTripOf = new Map(weekDrops.map((d) => [d.id, d.tripId]));
  const oldPrint = await prisma.orders.findMany({
    where: { tripDropId: { in: weekDrops.map((d) => d.id) }, isRemoved: false, ...BILLABLE_BILL_WHERE },
    select: { id: true, tripDropId: true },
  });
  const newPrintRows = await prisma.order_invoices.findMany({
    where: { tripDropId: { in: weekDrops.map((d) => d.id) }, order: { isRemoved: false, ...BILLABLE_BILL_WHERE } },
    select: { orderId: true, tripDropId: true },
  });
  const pa = setEq(oldPrint.map((o) => `${weekTripOf.get(o.tripDropId!)}:${o.id}`), newPrintRows.map((r) => `${weekTripOf.get(r.tripDropId!)}:${r.orderId}`));
  console.log(`print (trip, bill) last 7 days: old ${oldPrint.length} · rows ${new Set(newPrintRows.map((r) => `${weekTripOf.get(r.tripDropId!)}:${r.orderId}`)).size} · ${pa.ok ? "same" : "DIFFERENT"}`);
  if (!pa.ok) fail(`print only old ${pa.onlyA.slice(0, 10)} only rows ${pa.onlyB.slice(0, 10)}`);

  console.log(
    failures === 0
      ? "\nPARITY OK — 0 differences (compare: no NEW Seq Scan on orders, no index lost)"
      : `\nPARITY FAILED — ${failures} problem(s)`,
  );
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
