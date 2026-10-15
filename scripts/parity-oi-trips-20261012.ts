// scripts/parity-oi-trips-20261012.ts — READ-ONLY parity for Add invoices
// Phase 3 readers (Schema v27.66). SELECTs only; writes nothing. Reused by
// readers B and C. Run: npx tsx scripts/parity-oi-trips-20261012.ts
//
// For EVERY trip that is not cancelled, the bill set and the per-stop bill set
// read the OLD way (orders."tripDropId" IN the trip's stops) and the NEW way
// (an invoice row on one of the stops, placed by lib/order-invoices/trip-read.ts
// placeOnTrips). Both with and without removed bills. Every difference is
// printed; the last line says PARITY OK or PARITY FAILED.
//
// Then EXPLAIN (text) of the trip-detail bill read (lib/trips/queries.ts
// loadTripBills' orders.findMany) for the trip with the most stops — old shape
// and new shape, the SQL captured from Prisma's own query log.
//
// --since=Nd (P5-2, 2026-10-15): only trips dated in the last N days plus every
// LIVE trip (draft / released), whatever its date — the depot PC runs out of
// memory on the full history. Omitted = every non-cancelled trip, as before.
// Always (whatever --since says; one cheap SQL over ALL OBDs): the DERIVED STOP
// check — 0 OBDs whose orders."tripDropId" differs from the stop of their
// lowest-seq invoice row that has one (the v27.66 rule trip-link.ts writes).

import { PrismaClient, type Prisma } from "@prisma/client";
import { readFileSync } from "fs";
import { onStopsWhere, placeOnTrips, stopRowsSelect } from "../lib/order-invoices/trip-read";

const prisma = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
let captured: { query: string; params: string }[] = [];
prisma.$on("query", (e) => captured.push({ query: e.query, params: e.params }));

const sinceArg = process.argv.find((a) => a.startsWith("--since="));
const SINCE_DAYS = sinceArg ? Number(sinceArg.slice("--since=".length).replace(/d$/, "")) : null;
if (SINCE_DAYS !== null && !(Number.isInteger(SINCE_DAYS) && SINCE_DAYS > 0)) throw new Error(`bad ${sinceArg}`);
// --scope=<file> (P5-2): the frozen trip set from scripts/parity-oi-scope-p5-2.ts — wins over --since.
const scopeArg = process.argv.find((a) => a.startsWith("--scope="));
const SCOPE_IDS: number[] | null = scopeArg
  ? (JSON.parse(readFileSync(scopeArg.slice("--scope=".length), "utf8")) as { ids: number[] }).ids
  : null;

type Sets = Map<number, Set<string>>; // tripId → "dropId:orderId"

function key(dropId: number, orderId: number) {
  return `${dropId}:${orderId}`;
}

async function oldWay(dropIds: number[], tripOf: Map<number, number>, withRemoved: boolean): Promise<Sets> {
  const out: Sets = new Map();
  const rows = await prisma.orders.findMany({
    where: { tripDropId: { in: dropIds }, ...(withRemoved ? {} : { isRemoved: false }) },
    select: { id: true, tripDropId: true },
  });
  for (const o of rows) {
    const t = tripOf.get(o.tripDropId!)!;
    const s = out.get(t) ?? new Set<string>();
    s.add(key(o.tripDropId!, o.id));
    out.set(t, s);
  }
  return out;
}

async function newWay(dropIds: number[], tripOf: Map<number, number>, withRemoved: boolean): Promise<Sets> {
  const out: Sets = new Map();
  const found = await prisma.orders.findMany({
    where: { ...onStopsWhere(dropIds), ...(withRemoved ? {} : { isRemoved: false }) },
    select: { id: true, invoices: stopRowsSelect(dropIds) },
  });
  for (const p of placeOnTrips(found, tripOf)) {
    const s = out.get(p.tripId) ?? new Set<string>();
    s.add(key(p.tripDropId, p.id));
    out.set(p.tripId, s);
  }
  return out;
}

function inline(query: string, params: string): string {
  const vals = JSON.parse(params) as unknown[];
  return query.replace(/\$(\d+)/g, (_m, n: string) => {
    const v = vals[Number(n) - 1];
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (v === null) return "NULL";
    return `'${String(v).replace(/'/g, "''")}'`;
  });
}

async function explain(label: string, run: () => Promise<unknown>) {
  captured = [];
  await run();
  const q = captured.find((c) => /FROM "public"\."orders"/.test(c.query) && /SELECT/.test(c.query));
  if (!q) {
    console.log(`\n--- EXPLAIN ${label}: query not captured`);
    return;
  }
  const plan = await prisma.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN ${inline(q.query, q.params)}`);
  console.log(`\n--- EXPLAIN ${label} ---`);
  for (const r of plan) console.log("  " + r["QUERY PLAN"]);
}

(async () => {
  // IST today minus N days, in the UTC-midnight @db.Date shape trips.tripDate has.
  const sinceDate =
    SINCE_DAYS === null ? null : new Date(`${new Date(Date.now() + 5.5 * 3_600_000 - SINCE_DAYS * 86_400_000).toISOString().slice(0, 10)}T00:00:00Z`);
  const sinceWhere: Prisma.tripsWhereInput =
    SCOPE_IDS !== null ? { id: { in: SCOPE_IDS } } : sinceDate === null ? {} : { tripDate: { gte: sinceDate } };
  const trips = await prisma.trips.findMany({ where: { status: { not: "cancelled" }, ...sinceWhere }, select: { id: true, tripNumber: true } });
  console.log(
    SCOPE_IDS !== null
      ? `scope: --scope file, ${SCOPE_IDS.length} trips (${trips.length} not cancelled now)`
      : sinceDate === null
        ? "scope: every non-cancelled trip"
        : `scope: --since=${SINCE_DAYS}d — trips dated ≥ ${sinceDate.toISOString().slice(0, 10)}`,
  );

  // The DERIVED STOP check, over ALL OBDs (one SQL, read-only).
  const [derived] = await prisma.$queryRawUnsafe<{ n: bigint; sample: string | null }[]>(`
    WITH d AS (
      SELECT DISTINCT ON ("orderId") "orderId", "tripDropId"
        FROM order_invoices WHERE "tripDropId" IS NOT NULL ORDER BY "orderId", seq
    )
    SELECT count(*) AS n,
           string_agg(o.id::text || ':' || coalesce(o."tripDropId"::text, 'null') || '≠' || coalesce(d."tripDropId"::text, 'null'), ' ' ORDER BY o.id) AS sample
      FROM orders o LEFT JOIN d ON d."orderId" = o.id
     WHERE o."tripDropId" IS DISTINCT FROM d."tripDropId"`);
  const derivedDiffs = Number(derived.n);
  console.log(
    `derived stop check (all OBDs): orders.tripDropId ≠ lowest-seq row's stop: ${derivedDiffs}` +
      (derivedDiffs > 0 ? ` [${(derived.sample ?? "").slice(0, 400)}]` : ""),
  );
  // v27.69 (P5-2): the dual-written flag — orders."partlyOnTrip" ⇔ some row on a
  // stop AND some row on none. Same SQL as PART 4 of the v27.69 file. Skipped
  // (reported) before the column exists.
  const [hasFlag] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'partlyOnTrip'`,
  );
  let flagDiffs = 0;
  if (Number(hasFlag.n) === 0) {
    console.log(`partlyOnTrip check: column not present — skipped`);
  } else {
    const [flag] = await prisma.$queryRawUnsafe<{ n: bigint; t: bigint; sample: string | null }[]>(`
      SELECT count(*) FILTER (WHERE o."partlyOnTrip" IS DISTINCT FROM coalesce(x.v, false)) AS n,
             count(*) FILTER (WHERE o."partlyOnTrip") AS t,
             string_agg(o.id::text, ' ' ORDER BY o.id) FILTER (WHERE o."partlyOnTrip" IS DISTINCT FROM coalesce(x.v, false)) AS sample
        FROM orders o
        LEFT JOIN (SELECT "orderId", bool_or("tripDropId" IS NOT NULL) AND bool_or("tripDropId" IS NULL) AS v
                     FROM order_invoices GROUP BY "orderId") x ON x."orderId" = o.id`);
    flagDiffs = Number(flag.n);
    console.log(
      `partlyOnTrip check (all OBDs): flag ≠ rows: ${flagDiffs} · flag true: ${Number(flag.t)}` +
        (flagDiffs > 0 ? ` [${(flag.sample ?? "").slice(0, 400)}]` : ""),
    );
  }
  const drops = await prisma.trip_drops.findMany({
    where: { tripId: { in: trips.map((t) => t.id) } },
    select: { id: true, tripId: true },
  });
  const tripOf = new Map(drops.map((d) => [d.id, d.tripId]));
  const dropIds = drops.map((d) => d.id);
  const tripNo = new Map(trips.map((t) => [t.id, t.tripNumber]));
  console.log(`trips (not cancelled): ${trips.length} · stops: ${drops.length}`);

  let diffs = derivedDiffs + flagDiffs;
  for (const withRemoved of [false, true]) {
    const label = withRemoved ? "incl. removed" : "not removed";
    const a = await oldWay(dropIds, tripOf, withRemoved);
    const b = await newWay(dropIds, tripOf, withRemoved);
    let bills = 0;
    let tripsWithBills = 0;
    let tripDiffs = 0;
    for (const t of trips) {
      const sa = a.get(t.id) ?? new Set<string>();
      const sb = b.get(t.id) ?? new Set<string>();
      bills += sa.size;
      if (sa.size > 0) tripsWithBills += 1;
      const onlyOld = Array.from(sa).filter((k) => !sb.has(k));
      const onlyNew = Array.from(sb).filter((k) => !sa.has(k));
      // Bill set ignoring the stop, too — catches a bill on the right trip but the wrong stop separately.
      const billsOld = new Set(Array.from(sa).map((k) => k.split(":")[1]));
      const billsNew = new Set(Array.from(sb).map((k) => k.split(":")[1]));
      const billOnlyOld = Array.from(billsOld).filter((k) => !billsNew.has(k));
      const billOnlyNew = Array.from(billsNew).filter((k) => !billsOld.has(k));
      if (onlyOld.length + onlyNew.length > 0) {
        tripDiffs += 1;
        diffs += onlyOld.length + onlyNew.length;
        console.log(`  DIFF ${label} ${tripNo.get(t.id)} (trip ${t.id}): stop:bill only OLD [${onlyOld}] only NEW [${onlyNew}] · bills only OLD [${billOnlyOld}] only NEW [${billOnlyNew}]`);
      }
    }
    console.log(`${label}: trips with bills ${tripsWithBills} · (stop, bill) pairs OLD ${bills} · trips differing ${tripDiffs}`);
  }

  // EXPLAIN — the trip with the most stops, loadTripBills' shape.
  const counts = new Map<number, number>();
  for (const d of drops) counts.set(d.tripId, (counts.get(d.tripId) ?? 0) + 1);
  const big = Array.from(counts.entries()).sort((x, y) => y[1] - x[1])[0];
  if (big) {
    const ids = drops.filter((d) => d.tripId === big[0]).map((d) => d.id);
    console.log(`\nEXPLAIN on ${tripNo.get(big[0])} (${ids.length} stops)`);
    const select: Prisma.ordersSelect = { id: true, workflowStage: true, dispatchStatus: true, materialType: true, customerId: true, shipToOverrideCustomerId: true };
    await explain("OLD orders.tripDropId IN (…)", () =>
      prisma.orders.findMany({ where: { tripDropId: { in: ids }, isRemoved: false }, select: { ...select, tripDropId: true }, orderBy: { id: "asc" } }),
    );
    await explain("NEW invoices some tripDropId IN (…)", () =>
      prisma.orders.findMany({ where: { ...onStopsWhere(ids), isRemoved: false }, select: { ...select, invoices: stopRowsSelect(ids) }, orderBy: { id: "asc" } }),
    );
  }

  console.log(diffs === 0 ? "\nPARITY OK — 0 differences" : `\nPARITY FAILED — ${diffs} differences`);
  await prisma.$disconnect();
  process.exit(diffs === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
