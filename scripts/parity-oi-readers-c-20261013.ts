// scripts/parity-oi-readers-c-20261013.ts — READ-ONLY parity for Add invoices
// Phase 3 readers C (trip actions + guards). SELECTs only; writes nothing.
// Sibling of scripts/parity-oi-trips-20261012.ts (readers A) and
// scripts/parity-oi-readers-b-20261012.ts (readers B).
//
//   npx tsx scripts/parity-oi-readers-c-20261013.ts snapshot <file.json>
//       run on the OLD code: picks the sample and dumps what the real
//       functions return (isBillOnSentTrip, the Tint Base tab, the challan marker).
//   npx tsx scripts/parity-oi-readers-c-20261013.ts compare <file.json>
//       run on the NEW code: the same sample, the same dump, diffed.
//   npx tsx scripts/parity-oi-readers-c-20261013.ts
//       no file: only the code-independent checks and the EXPLAINs.
//
// Code-independent checks (the OLD orders."tripDropId" predicate vs the invoice
// rows, computed here whatever the code says):
//   · trip actions, for EVERY non-cancelled trip: the bill list each of
//     cancel (dispatched count + detach list), dispatch (bill list + outstanding
//     count) and bills add/remove would act on;
//   · guards, for a sample of ≥ 500 recent bills (on trips, off trips, held, on
//     sent / shown / unsent trips): offFloorRefusal, billingRefusal (every action
//     and mode), onTripRefusal — allow/refuse AND message, fed from orders
//     (old) vs from the rows (lowest-seq row's stop and its trip number); the
//     bills route's add / remove decision against the bill's own trip and
//     another trip; isBillOnSentTrip's predicate;
//   · the Tint Base tab's "joined today on trip T" arms and the challan marker's
//     tripMax.
// EXPLAIN (text), old shape vs new shape: the cancel / dispatch reads for the
// trip with the most stops, isBillOnSentTrip, obdStopOnTrip. Fails on a Seq
// Scan on orders in a new shape that the old shape did not have.
//
// --since=Nd (P5-2, 2026-10-15): trips = dated in the last N days plus every
// live trip (draft / released); the guard sample's "on a trip" half reads the
// same N days. Omitted = as before (every non-cancelled trip, 10 days).
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

/** EXPLAIN every captured query of one read; returns whether orders is seq-scanned. */
async function explainAll(label: string): Promise<boolean> {
  const qs = captured.filter((c) => /^s*SELECT/.test(c.query));
  const lines: string[] = [];
  for (const q of qs) {
    const plan = await prisma.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN ${inline(q.query, q.params)}`);
    if (lines.length > 0) lines.push("  ·· next query of the same read ··");
    lines.push(...plan.map((r) => r["QUERY PLAN"]));
  }
  console.log(`\n--- EXPLAIN ${label} (${lines.length} lines) ---`);
  for (const l of lines) console.log("  " + l);
  const seq = lines.some((l) => /Seq Scan on orders\b/.test(l));
  const indexes = Array.from(
    new Set(lines.flatMap((l) => Array.from(l.matchAll(/(?:Index Scan|Index Only Scan|Bitmap Index Scan) (?:using|on) "?([A-Za-z_]+)"?/g)).map((m) => m[1]))),
  ).sort();
  console.log(`  → Seq Scan on orders: ${seq ? "YES" : "no"} · indexes: ${indexes.join(", ")}`);
  return seq;
}

const setEq = (a: Iterable<number | string>, b: Iterable<number | string>) => {
  const A = new Set(a);
  const B = new Set(b);
  const onlyA = Array.from(A).filter((x) => !B.has(x));
  const onlyB = Array.from(B).filter((x) => !A.has(x));
  return { ok: onlyA.length + onlyB.length === 0, onlyA, onlyB };
};

interface Dump {
  pairs: [number, number][]; // (orderId, tripId) sample for isBillOnSentTrip
  sentHits: string[]; // "orderId:tripId" the real function answered true for
  baseDays: string[];
  baseRows: Record<string, number[]>;
  challanMarker: { count: number; latest: string | null; signature: string };
}

(async () => {
  const { isBillOnSentTrip } = await import("../lib/billing/print");
  const { getTintBaseRows } = await import("../lib/tint/base-feed");
  const { getChallanMarker } = await import("../lib/challan-orders/board");
  const { offFloorRefusal } = await import("../lib/floor/off-floor");
  const { billingRefusal, onTripRefusal, BILLING_ACTIONS } = await import("../lib/billing/refusal");
  const { computeDropKey } = await import("../lib/trips/drop-key");
  const tripRead = (await import("../lib/order-invoices/trip-read")) as Record<string, unknown>;
  const { onStopsWhere } = await import("../lib/order-invoices/trip-read");
  const { getTodayIST } = await import("../lib/dates");
  const { DISPATCHED } = await import("../lib/workflow-stages");

  const today = getTodayIST();
  const dayMinus = (n: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };

  // ════ 1. TRIP ACTIONS — every non-cancelled trip ═══════════════════════════
  const trips = await prisma.trips.findMany({
    where:
      SCOPE_IDS !== null
        ? { status: { not: "cancelled" }, id: { in: SCOPE_IDS } }
        : SINCE_DAYS === null
          ? { status: { not: "cancelled" } }
          : { status: { not: "cancelled" }, tripDate: { gte: new Date(`${dayMinus(SINCE_DAYS)}T00:00:00Z`) } },
    select: { id: true, tripNumber: true, tripDate: true, status: true, shownAt: true, sentToBillingAt: true },
    orderBy: { id: "asc" },
  });
  const drops = await prisma.trip_drops.findMany({ where: { tripId: { in: trips.map((t) => t.id) } }, select: { id: true, tripId: true, dropKey: true } });
  const tripOfDrop = new Map(drops.map((d) => [d.id, d.tripId]));
  const allDropIds = drops.map((d) => d.id);
  console.log(`non-cancelled trips ${trips.length} · stops ${drops.length}`);

  // The routes' four reads, each with its own filter (Prisma semantics, so a
  // NULL dispatchStatus behaves exactly as in the route).
  const actionReads: [string, Prisma.ordersWhereInput][] = [
    ["cancel: dispatched count", { workflowStage: DISPATCHED }],
    ["cancel: detach list (removed included)", {}],
    ["dispatch: bill list", { isRemoved: false }],
    ["dispatch: outstanding count", { isRemoved: false, workflowStage: { not: DISPATCHED }, dispatchStatus: { not: "hold" } }],
  ];
  for (const [label, extra] of actionReads) {
    const oldRows = await prisma.orders.findMany({ where: { tripDropId: { in: allDropIds }, ...extra }, select: { id: true, tripDropId: true } });
    const oldKeys = oldRows.map((o) => `${tripOfDrop.get(o.tripDropId!)}:${o.id}`);
    const newRows = await prisma.orders.findMany({
      where: { ...onStopsWhere(allDropIds), ...extra },
      select: { id: true, invoices: { where: { tripDropId: { in: allDropIds } }, select: { tripDropId: true } } },
    });
    const newKeys = Array.from(new Set(newRows.flatMap((o) => o.invoices.map((r) => `${tripOfDrop.get(r.tripDropId!)}:${o.id}`))));
    const r = setEq(oldKeys, newKeys);
    const perTripOld = new Map<string, number>();
    for (const k of oldKeys) perTripOld.set(k.split(":")[0], (perTripOld.get(k.split(":")[0]) ?? 0) + 1);
    console.log(`${label}: (trip, bill) old ${oldKeys.length} · rows ${newKeys.length} · trips with bills ${perTripOld.size} · ${r.ok ? "same" : "DIFFERENT"}`);
    if (!r.ok) fail(`${label}: only old ${r.onlyA.slice(0, 10)} · only rows ${r.onlyB.slice(0, 10)}`);
  }

  // The exact per-trip queries the routes run, for the 40 most recent trips.
  const recent = trips.slice(-40);
  let exactDiffs = 0;
  for (const t of recent) {
    const ids = drops.filter((d) => d.tripId === t.id).map((d) => d.id);
    if (ids.length === 0) continue;
    for (const [label, extra] of actionReads) {
      const a = await prisma.orders.findMany({ where: { tripDropId: { in: ids }, ...extra }, select: { id: true }, orderBy: { id: "asc" } });
      const b = await prisma.orders.findMany({ where: { ...onStopsWhere(ids), ...extra }, select: { id: true }, orderBy: { id: "asc" } });
      const ca = await prisma.orders.count({ where: { tripDropId: { in: ids }, ...extra } });
      const cb = await prisma.orders.count({ where: { ...onStopsWhere(ids), ...extra } });
      if (a.map((o) => o.id).join() !== b.map((o) => o.id).join() || ca !== cb) {
        exactDiffs += 1;
        fail(`${t.tripNumber} ${label}: old [${a.map((o) => o.id)}] (${ca}) rows [${b.map((o) => o.id)}] (${cb})`);
      }
    }
  }
  console.log(`exact per-trip route reads, ${recent.length} most recent trips × ${actionReads.length}: differing ${exactDiffs}`);

  // ════ 2. GUARDS — a sample of ≥ 500 recent bills ═══════════════════════════
  let dump: Dump;
  if (mode === "compare") {
    dump = JSON.parse(readFileSync(file, "utf8")) as Dump;
  } else {
    const weekTripIds = trips.filter((t) => t.tripDate >= new Date(`${dayMinus(SINCE_DAYS ?? 10)}T00:00:00Z`)).map((t) => t.id);
    const onTrip = await prisma.order_invoices.findMany({
      where: { tripDrop: { tripId: { in: weekTripIds } } },
      select: { orderId: true },
      distinct: ["orderId"],
    });
    const offTrip = await prisma.orders.findMany({ where: { tripDropId: null }, select: { id: true }, orderBy: { id: "desc" }, take: 250 });
    const held = await prisma.orders.findMany({ where: { dispatchStatus: "hold" }, select: { id: true }, orderBy: { id: "desc" }, take: 120 });
    const sampleIds = Array.from(new Set([...onTrip.map((r) => r.orderId), ...offTrip.map((o) => o.id), ...held.map((o) => o.id)])).sort((a, b) => a - b);
    // For each bill: its own trip (from orders), one sent trip, one unsent trip.
    const sent = trips.filter((t) => t.sentToBillingAt !== null).slice(-1)[0];
    const unsent = trips.filter((t) => t.sentToBillingAt === null).slice(-1)[0];
    const own = await prisma.orders.findMany({ where: { id: { in: sampleIds } }, select: { id: true, tripDrop: { select: { tripId: true } } } });
    const pairs: [number, number][] = [];
    for (const o of own) {
      const ts = new Set<number>([o.tripDrop?.tripId, sent?.id, unsent?.id].filter((x): x is number => x != null));
      for (const t of Array.from(ts)) pairs.push([o.id, t]);
    }
    dump = { pairs, sentHits: [], baseDays: [today, dayMinus(1)], baseRows: {}, challanMarker: { count: 0, latest: null, signature: "" } };
  }
  const sampleIds = Array.from(new Set(dump.pairs.map((p) => p[0])));

  const bills = await prisma.orders.findMany({
    where: { id: { in: sampleIds } },
    select: {
      id: true, obdNumber: true, workflowStage: true, dispatchStatus: true, isRemoved: true,
      customerId: true, shipToOverrideCustomerId: true, shipToCustomerId: true, shipToText: true, shipToAreaId: true,
      tripDropId: true, tripDrop: { select: { tripId: true, dropKey: true, trip: { select: { tripNumber: true } } } },
    },
  });
  const rows = await prisma.order_invoices.findMany({
    where: { orderId: { in: sampleIds }, tripDropId: { not: null } },
    select: { orderId: true, seq: true, tripDropId: true, tripDrop: { select: { tripId: true, dropKey: true, trip: { select: { tripNumber: true, sentToBillingAt: true, status: true } } } } },
  });
  const rowsBy = new Map<number, typeof rows>();
  for (const r of rows) rowsBy.set(r.orderId, [...(rowsBy.get(r.orderId) ?? []), r].sort((x, y) => x.seq - y.seq));
  const tripById = new Map(trips.map((t) => [t.id, t]));
  const allTrips = await prisma.trips.findMany({ where: { id: { in: Array.from(new Set(dump.pairs.map((p) => p[1]))) } }, select: { id: true, sentToBillingAt: true, status: true } });
  const anyTripById = new Map(allTrips.map((t) => [t.id, t]));

  const mix = {
    onTrip: bills.filter((b) => b.tripDropId !== null).length,
    offTrip: bills.filter((b) => b.tripDropId === null).length,
    held: bills.filter((b) => b.dispatchStatus === "hold").length,
    onSent: bills.filter((b) => b.tripDrop && tripById.get(b.tripDrop.tripId)?.sentToBillingAt).length,
    onShown: bills.filter((b) => b.tripDrop && tripById.get(b.tripDrop.tripId)?.shownAt).length,
    onUnshown: bills.filter((b) => b.tripDrop && tripById.get(b.tripDrop.tripId) && !tripById.get(b.tripDrop.tripId)?.shownAt).length,
  };
  console.log(`\nguard sample: ${bills.length} bills · ${JSON.stringify(mix)} · (bill, trip) pairs ${dump.pairs.length}`);
  if (bills.length < 500) fail(`sample only ${bills.length} bills`);

  let guardChecks = 0;
  let guardDiffs = 0;
  const cmp = (what: string, a: unknown, b: unknown) => {
    guardChecks += 1;
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      guardDiffs += 1;
      if (guardDiffs <= 10) fail(`${what}: old ${JSON.stringify(a)} · rows ${JSON.stringify(b)}`);
    }
  };
  const billById = new Map(bills.map((b) => [b.id, b]));
  for (const b of bills) {
    const lowest = rowsBy.get(b.id)?.[0];
    const oldIn = { workflowStage: b.workflowStage, isRemoved: b.isRemoved, tripDropId: b.tripDropId, tripNumber: b.tripDrop?.trip.tripNumber ?? null };
    const newIn = { workflowStage: b.workflowStage, isRemoved: b.isRemoved, tripDropId: lowest?.tripDropId ?? null, tripNumber: lowest?.tripDrop?.trip.tripNumber ?? null };
    cmp(`${b.id} offFloorRefusal`, offFloorRefusal(oldIn), offFloorRefusal(newIn));
    cmp(`${b.id} offFloorRefusal allowTintRoom`, offFloorRefusal(oldIn, { allowTintRoom: true }), offFloorRefusal(newIn, { allowTintRoom: true }));
    cmp(`${b.id} onTripRefusal`, onTripRefusal(oldIn), onTripRefusal(newIn));
    for (const a of BILLING_ACTIONS) {
      for (const m of ["set", "clear"] as const) cmp(`${b.id} billingRefusal ${a}/${m}`, billingRefusal(a, oldIn, m), billingRefusal(a, newIn, m));
    }
  }

  // The bills route's decisions, OLD (as the route read them before C) vs ROWS.
  const oldDecision = (b: (typeof bills)[number], tripId: number, action: "add" | "remove"): string => {
    if (action === "remove") {
      return b.tripDropId === null || b.tripDrop === null || b.tripDrop.tripId !== tripId ? "refuse:Not on this trip" : `remove:${b.tripDropId}`;
    }
    if (b.workflowStage === "challan_linked") return "refuse:challan";
    if (b.tripDropId === null) return "attach";
    const cur = b.tripDrop;
    if (cur && cur.tripId === tripId && cur.dropKey === computeDropKey(b)) return "skip";
    return cur && cur.tripId !== tripId ? `refuse:Already on ${cur.trip.tripNumber}` : "refuse:different stop on this trip";
  };
  const rowsDecision = (b: (typeof bills)[number], here: { id: number; dropKey: string } | null, action: "add" | "remove"): string => {
    if (action === "remove") return here === null ? "refuse:Not on this trip" : `remove:${here.id}`;
    if (b.workflowStage === "challan_linked") return "refuse:challan";
    if (b.tripDropId === null) return "attach"; // "on ANY trip" stays on orders (equivalence)
    if (here !== null) return here.dropKey === computeDropKey(b) ? "skip" : "refuse:different stop on this trip";
    const lowest = rowsBy.get(b.id)?.[0];
    return lowest ? `refuse:Already on ${lowest.tripDrop!.trip.tripNumber}` : "refuse:different stop on this trip";
  };
  const obdStopOnTrip = tripRead.obdStopOnTrip as ((o: number, t: number) => Promise<{ id: number; dropKey: string } | null>) | undefined;
  let decisions = 0;
  let libChecked = 0;
  for (const [orderId, tripId] of dump.pairs) {
    const b = billById.get(orderId);
    if (!b) continue;
    const onThis = (rowsBy.get(orderId) ?? []).filter((r) => r.tripDrop!.tripId === tripId);
    const here = onThis[0] ? { id: onThis[0].tripDropId!, dropKey: onThis[0].tripDrop!.dropKey } : null;
    if (obdStopOnTrip && libChecked < 300) {
      libChecked += 1;
      cmp(`${orderId}@${tripId} obdStopOnTrip (lib vs inline rows)`, await obdStopOnTrip(orderId, tripId), here);
    }
    for (const action of ["add", "remove"] as const) {
      decisions += 1;
      cmp(`${orderId}@${tripId} bills ${action}`, oldDecision(b, tripId, action), rowsDecision(b, here, action));
    }
    // isBillOnSentTrip's predicate, old vs rows.
    const t = anyTripById.get(tripId);
    const sentOk = !!t && t.sentToBillingAt !== null && t.status !== "cancelled";
    const oldSent = !b.isRemoved && b.tripDrop?.tripId === tripId && sentOk;
    const rowsSent = !b.isRemoved && onThis.length > 0 && sentOk;
    cmp(`${orderId}@${tripId} isBillOnSentTrip predicate`, oldSent, rowsSent);
  }
  console.log(`guards: ${guardChecks} answers compared (refusals per bill, ${decisions} bills-route decisions, ${dump.pairs.length} sent-trip predicates${obdStopOnTrip ? `, ${libChecked} lib obdStopOnTrip` : ""}) · differing ${guardDiffs}`);

  // ════ 3. THE REAL FUNCTIONS (snapshot / compare) ═══════════════════════════
  const sentHits: string[] = [];
  captured = [];
  for (const [orderId, tripId] of dump.pairs) if (await isBillOnSentTrip(orderId, tripId)) sentHits.push(`${orderId}:${tripId}`);
  const sentCaptured = captured.filter((c) => /^s*SELECT/.test(c.query)).slice(0, 1);
  console.log(`isBillOnSentTrip: ${dump.pairs.length} pairs · true for ${sentHits.length}`);

  const baseRows: Record<string, number[]> = {};
  for (const d of dump.baseDays) {
    baseRows[d] = (await getTintBaseRows(d === today ? undefined : d)).map((r) => r.orderId).sort((a, b) => a - b);
    console.log(`Tint Base tab ${d}: ${baseRows[d].length} rows`);
  }
  const challanMarker = await getChallanMarker();
  console.log(`challan marker: ${JSON.stringify(challanMarker)}`);

  if (mode === "snapshot") {
    writeFileSync(file, JSON.stringify({ ...dump, sentHits, baseRows, challanMarker }));
    console.log(`snapshot written → ${file}`);
  } else if (mode === "compare") {
    const s = setEq(dump.sentHits, sentHits);
    console.log(`isBillOnSentTrip vs snapshot: ${s.ok ? "same" : "DIFFERENT"}`);
    if (!s.ok) fail(`isBillOnSentTrip only old ${s.onlyA.slice(0, 10)} only new ${s.onlyB.slice(0, 10)}`);
    for (const d of dump.baseDays) {
      const r = setEq(dump.baseRows[d] ?? [], baseRows[d]);
      console.log(`Tint Base ${d} vs snapshot: ${dump.baseRows[d]?.length} → ${baseRows[d].length} ${r.ok ? "same" : "DIFFERENT"}`);
      if (!r.ok) fail(`Tint Base ${d}: only old ${r.onlyA.slice(0, 10)} only new ${r.onlyB.slice(0, 10)}`);
    }
    const same = JSON.stringify(dump.challanMarker) === JSON.stringify(challanMarker);
    console.log(`challan marker vs snapshot: ${same ? "same" : "DIFFERENT"} (${JSON.stringify(dump.challanMarker)})`);
    if (!same) fail("challan marker differs");
  }

  // ════ 4. CODE-INDEPENDENT: Tint Base trip arms + challan tripMax ═══════════
  for (const d of dump.baseDays) {
    const start = new Date(`${d}T00:00:00+05:30`);
    const end = new Date(start.getTime() + 86_400_000);
    const acts = await prisma.trip_activity.findMany({ where: { action: "bills_added", createdAt: { gte: start, lt: end } }, select: { tripId: true, detail: true } });
    let arms = 0;
    let armDiffs = 0;
    for (const a of acts) {
      const ids = ((a.detail as { orderIds?: unknown } | null)?.orderIds as number[] | undefined)?.filter((x) => Number.isInteger(x)) ?? [];
      if (ids.length === 0) continue;
      arms += 1;
      const o = await prisma.orders.findMany({ where: { id: { in: ids }, tripDrop: { tripId: a.tripId } }, select: { id: true } });
      const n = await prisma.orders.findMany({ where: { id: { in: ids }, invoices: { some: { tripDrop: { tripId: a.tripId } } } }, select: { id: true } });
      const r = setEq(o.map((x) => x.id), n.map((x) => x.id));
      if (!r.ok) {
        armDiffs += 1;
        fail(`Tint Base ${d} trip ${a.tripId}: only old ${r.onlyA} only rows ${r.onlyB}`);
      }
    }
    console.log(`Tint Base cut-off ${d}: ${arms} "joined on trip T" arms · differing ${armDiffs}`);
  }
  const [cm] = await prisma.$queryRawUnsafe<{ oldMax: Date | null; newMax: Date | null }[]>(`
    SELECT
      (SELECT max(t."updatedAt") FROM trips t JOIN trip_drops d ON d."tripId" = t.id
         JOIN orders o ON o."tripDropId" = d.id WHERE o."isChallanOrder" = true) AS "oldMax",
      (SELECT max(t."updatedAt") FROM trips t JOIN trip_drops d ON d."tripId" = t.id
         JOIN order_invoices oi ON oi."tripDropId" = d.id JOIN orders o ON o.id = oi."orderId"
        WHERE o."isChallanOrder" = true AND o."tripDropId" IS NOT NULL) AS "newMax"`);
  const cmSame = (cm.oldMax?.getTime() ?? null) === (cm.newMax?.getTime() ?? null);
  console.log(`challan tripMax: old ${cm.oldMax?.toISOString() ?? null} · rows ${cm.newMax?.toISOString() ?? null} · ${cmSame ? "same" : "DIFFERENT"}`);
  if (!cmSame) fail("challan tripMax differs");

  // ════ 5. EXPLAIN — old shape vs new shape ══════════════════════════════════
  const stopsPer = new Map<number, number[]>();
  for (const d of drops) stopsPer.set(d.tripId, [...(stopsPer.get(d.tripId) ?? []), d.id]);
  const [bigTrip, bigIds] = Array.from(stopsPer.entries()).sort((a, b) => b[1].length - a[1].length)[0];
  console.log(`\nEXPLAIN trip: ${tripById.get(bigTrip)?.tripNumber} (${bigIds.length} stops)`);
  const shapes: [string, () => Promise<unknown>, () => Promise<unknown>][] = [
    ["cancel dispatched count",
      () => prisma.orders.count({ where: { tripDropId: { in: bigIds }, workflowStage: DISPATCHED } }),
      () => prisma.orders.count({ where: { ...onStopsWhere(bigIds), workflowStage: DISPATCHED } })],
    ["cancel detach list",
      () => prisma.orders.findMany({ where: { tripDropId: { in: bigIds } }, select: { id: true, obdNumber: true }, orderBy: { id: "asc" } }),
      () => prisma.orders.findMany({ where: { ...onStopsWhere(bigIds) }, select: { id: true, obdNumber: true }, orderBy: { id: "asc" } })],
    ["dispatch bill list",
      () => prisma.orders.findMany({ where: { tripDropId: { in: bigIds }, isRemoved: false }, select: { id: true, obdNumber: true }, orderBy: { id: "asc" } }),
      () => prisma.orders.findMany({ where: { ...onStopsWhere(bigIds), isRemoved: false }, select: { id: true, obdNumber: true }, orderBy: { id: "asc" } })],
    ["dispatch outstanding count",
      () => prisma.orders.count({ where: { tripDropId: { in: bigIds }, isRemoved: false, workflowStage: { not: DISPATCHED }, dispatchStatus: { not: "hold" } } }),
      () => prisma.orders.count({ where: { ...onStopsWhere(bigIds), isRemoved: false, workflowStage: { not: DISPATCHED }, dispatchStatus: { not: "hold" } } })],
  ];
  const sentPair = dump.pairs.find(([o, t]) => dump.sentHits.includes(`${o}:${t}`)) ?? dump.pairs[0];
  const sentTrip = { sentToBillingAt: { not: null }, status: { not: "cancelled" } } satisfies Prisma.tripsWhereInput;
  shapes.push(["isBillOnSentTrip",
    () => prisma.orders.findFirst({ where: { id: sentPair[0], isRemoved: false, tripDrop: { tripId: sentPair[1], trip: sentTrip } }, select: { id: true } }),
    () => prisma.orders.findFirst({ where: { id: sentPair[0], isRemoved: false, invoices: { some: { tripDrop: { trip: { id: sentPair[1], ...sentTrip } } } } }, select: { id: true } })]);
  const samplePair = dump.pairs.find(([o]) => billById.get(o)?.tripDropId != null) ?? dump.pairs[0];
  for (const [label, oldQ, newQ] of shapes) {
    captured = [];
    await oldQ();
    const so = await explainAll(`${label} — OLD (orders."tripDropId")`);
    captured = [];
    await newQ();
    const sn = await explainAll(`${label} — NEW (invoice rows)`);
    if (sn && !so) fail(`${label}: NEW Seq Scan on orders`);
  }
  if (sentCaptured.length > 0) {
    captured = sentCaptured;
    const s = await explainAll(`isBillOnSentTrip (${mode === "compare" ? "new code" : "this code"})`);
    if (s) fail("isBillOnSentTrip seq-scans orders");
  }
  if (obdStopOnTrip) {
    captured = [];
    await obdStopOnTrip(samplePair[0], samplePair[1]);
    if (await explainAll("obdStopOnTrip")) fail("obdStopOnTrip seq-scans orders");
  }
  // The challan marker is ONE raw statement; its trip arm is EXPLAINed on its own.
  for (const [label, join] of [
    ["OLD", `JOIN orders o ON o."tripDropId" = d.id WHERE o."isChallanOrder" = true`],
    ["NEW", `JOIN order_invoices oi ON oi."tripDropId" = d.id JOIN orders o ON o.id = oi."orderId" WHERE o."isChallanOrder" = true AND o."tripDropId" IS NOT NULL`],
  ] as const) {
    captured = [{ query: `SELECT max(t."updatedAt") FROM trips t JOIN trip_drops d ON d."tripId" = t.id ${join}`, params: "[]" }];
    const s = await explainAll(`challan marker tripMax — ${label}`);
    if (s && label === "NEW") fail("challan marker tripMax: NEW Seq Scan on orders");
  }

  console.log(
    failures === 0
      ? "\nPARITY OK — 0 differences (no NEW Seq Scan on orders)"
      : `\nPARITY FAILED — ${failures} problem(s)`,
  );
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
