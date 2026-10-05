/**
 * scripts/parity-billing-sync.ts — READ-ONLY parity for live feed billing 2b-i (2026-09-30).
 *
 *   npx tsx scripts/parity-billing-sync.ts
 *
 * DATABASE_URL from .env (production). SELECTs only.
 *
 *   1. Telephonic marker: OLD (the 7-statement body, frozen below verbatim from 29ae80a7) vs NEW
 *      (lib/billing/telephonic.ts getTelephonicMarker, one statement) — every field.
 *   2. Sync counts vs the MARKERS' counts, where "marker" = the logic as it stood in each marker
 *      route before this step (frozen below / in parity-pick-delete-legacy.ts):
 *        a. a synthetic "everything touched" call → all four counts must equal;
 *        b. recent real order / trip ids from live_changes (today) → every arm the classifier
 *           marks touched must carry the marker's count, and every count must equal it.
 *   3. An unrelated order id (and an unrelated trip id) → all touched = false, no counts.
 * A comparison that differs is re-run (up to 3 tries) before it counts. Exit 1 on any difference.
 *
 * 2026-10-01: section 0 asserts the pick-delete owner split (billing + tint = legacy), and the
 * expected pickDelete count is legacy − tint, since Billing's sync counts Billing's groups only.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { getTelephonicMarker, waitingTagWhere, type TelephonicMarker } from "@/lib/billing/telephonic";
import { buildBillingPendingWhere } from "@/lib/billing/picking-where";
import { getPrintWorkTripIds } from "@/lib/billing/print";
import { billingSync, classifyBillingSync, type SyncArms } from "@/lib/billing/sync";
import type { SyncBody } from "@/lib/billing/sync-rule";
import { getPickDeleteMarkerLegacy } from "./parity-pick-delete-legacy";
import { getPickDeleteMarker } from "@/lib/billing/pick-delete";

// ── OLD marker logic, frozen ───────────────────────────────────────────────

/** lib/billing/telephonic.ts getTelephonicMarker at 29ae80a7, verbatim. */
async function telephonicMarkerLegacy(now: Date): Promise<TelephonicMarker> {
  const count = await prisma.so_tags.count({ where: waitingTagWhere(now) });
  const tagMax = await prisma.so_tags.aggregate({ _max: { updatedAt: true } });
  const matchAgg = await prisma.so_tag_matches.aggregate({ _max: { appliedAt: true }, _count: true });
  const skipReasonCount = await prisma.so_tag_matches.count({ where: { ciSkipReason: { not: null } } });

  const matchedOrderIds = (
    await prisma.so_tag_matches.findMany({ select: { orderId: true }, distinct: ["orderId"] })
  ).map((m) => m.orderId);
  let orderMax: Date | null = null;
  let ciMax: Date | null = null;
  if (matchedOrderIds.length > 0) {
    orderMax = (await prisma.orders.aggregate({
      where: { id: { in: matchedOrderIds } }, _max: { updatedAt: true },
    }))._max.updatedAt;
    ciMax = (await prisma.ci_returns.aggregate({
      where: { orderId: { in: matchedOrderIds } }, _max: { updatedAt: true },
    }))._max.updatedAt;
  }

  const stamps = [tagMax._max.updatedAt, matchAgg._max.appliedAt, orderMax, ciMax]
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime());
  return {
    count,
    latest: stamps.length === 0 ? null : new Date(Math.max(...stamps)).toISOString(),
    matchCount: matchAgg._count,
    skipReasonCount,
    signature: `${matchAgg._count}:${skipReasonCount}`,
  };
}

/** app/api/billing/picking/marker/route.ts at 29ae80a7 — the count half, verbatim. */
async function pickingCountLegacy(): Promise<number> {
  const pendingWhere = await buildBillingPendingWhere();
  const countAgg = await prisma.orders.aggregate({ where: pendingWhere, _count: true });
  return countAgg._count;
}

/**
 * The Print marker's count. Was the 29ae80a7 body (work ids, then load the copied ones to confirm a
 * reopen); since Billing Print v2 (2026-10-05) getPrintWorkTripIds is EXACT and the marker counts
 * it directly, so the old body no longer describes the marker and would report a false difference.
 */
async function printCountLegacy(): Promise<number> {
  return (await getPrintWorkTripIds()).length;
}

async function markerCounts(now: Date) {
  return {
    picking: await pickingCountLegacy(),
    print: await printCountLegacy(),
    telephonic: (await telephonicMarkerLegacy(now)).count,
    // 2026-10-01 (Tint Manager tabs build step 4): Billing's sync now counts
    // Billing's groups only, so the expected count is the single-desk legacy
    // count MINUS the Tint Manager's (all-74/77) groups. Section 0 proves
    // billing + tint = legacy on its own, so this subtraction is not circular.
    pickDelete: (await getPickDeleteMarkerLegacy()).count - (await getPickDeleteMarker("tint")).count,
  };
}

// ── harness ────────────────────────────────────────────────────────────────

function stable(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === "object" && !Array.isArray(val) && !(val instanceof Date)) {
      return Object.keys(val as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (val as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return val;
  });
}

const diffs: string[] = [];
let compared = 0;
async function compare(label: string, run: () => Promise<[unknown, unknown]>): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const [a, b] = await run();
    if (stable(a) === stable(b)) {
      compared++;
      console.log(`  ✓ ${label}${attempt > 1 ? ` (equal on try ${attempt})` : ""}`);
      return;
    }
    if (attempt === 3) {
      compared++;
      diffs.push(label);
      console.log(`  ✗ ${label}\n      A ${stable(a).slice(0, 500)}\n      B ${stable(b).slice(0, 500)}`);
    }
  }
}

const ALL: SyncArms = { picking: true, print: true, telephonic: true, pickDelete: true, mailOrders: true };
const body = (p: Partial<SyncBody>): SyncBody => ({
  orderIds: [],
  tripIds: [],
  soTagChanged: false,
  mailOrderIds: [],
  ...p,
  shown: { pickingIds: [], printTripIds: [], printOrderIds: [], telephonicOrderIds: [], pickDeleteIds: [], ...(p.shown ?? {}) },
});

(async () => {
  console.log(`Billing sync parity — ${new Date().toISOString()}\n`);

  console.log("0. Pick delete split (2026-10-01): billing + tint = legacy");
  await compare("pick delete marker count: legacy = billing + tint", async () => {
    const b = (await getPickDeleteMarker("billing")).count;
    const t = (await getPickDeleteMarker("tint")).count;
    console.log(`    billing ${b} · tint ${t}`);
    return [(await getPickDeleteMarkerLegacy()).count, b + t];
  });

  console.log("1. Telephonic marker, OLD (7 statements) vs NEW (1)");
  await compare("telephonic marker — every field", async () => {
    const now = new Date();
    return [await telephonicMarkerLegacy(now), await getTelephonicMarker(now)];
  });
  for (const label of ["OLD", "NEW"] as const) {
    const t: number[] = [];
    for (let i = 0; i < 3; i++) {
      const s = Date.now();
      if (label === "OLD") await telephonicMarkerLegacy(new Date());
      else await getTelephonicMarker(new Date());
      t.push(Date.now() - s);
    }
    console.log(`    ${label}: ${t.join(" / ")} ms`);
  }

  // Samples from today's change book.
  const recentOrders = (
    await prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT "entityId" AS id FROM (
        SELECT "entityId" FROM live_changes WHERE entity = 'order' ORDER BY seq DESC LIMIT 400) x`
  ).map((r) => Number(r.id)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200);
  const recentTrips = (
    await prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT "entityId" AS id FROM (
        SELECT "entityId" FROM live_changes WHERE entity = 'trip' ORDER BY seq DESC LIMIT 200) x`
  ).map((r) => Number(r.id)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100);
  console.log(`\n   samples: ${recentOrders.length} recent order ids, ${recentTrips.length} recent trip ids`);

  console.log("\n2a. Synthetic 'everything touched' → sync counts = the four markers' counts");
  const anyOrder = recentOrders[0] ?? 1;
  const anyTrip = recentTrips[0] ?? 1;
  const everything = body({
    orderIds: [anyOrder],
    tripIds: [anyTrip],
    soTagChanged: true,
    mailOrderIds: [1],
    shown: { pickingIds: [anyOrder], printTripIds: [anyTrip], printOrderIds: [anyOrder], telephonicOrderIds: [anyOrder], pickDeleteIds: [anyOrder] },
  });
  await compare("all five arms touched", async () => [
    { picking: true, print: true, telephonic: true, pickDelete: true, mailOrders: true },
    (await classifyBillingSync(everything, ALL)),
  ]);
  await compare("counts = markers (picking, print, telephonic, pickDelete)", async () => {
    const now = new Date();
    return [await markerCounts(now), (await billingSync(everything, ALL, now)).counts];
  });

  console.log("\n2b. Recent real ids (today's live_changes) → touched arms carry the markers' counts");
  await compare("real batch: counts of touched arms = markers", async () => {
    const now = new Date();
    const res = await billingSync(body({ orderIds: recentOrders, tripIds: recentTrips }), ALL, now);
    const m = await markerCounts(now);
    const expected: Record<string, number> = {};
    for (const k of ["picking", "print", "telephonic", "pickDelete"] as const) if (res.touched[k]) expected[k] = m[k];
    console.log(`    touched: ${JSON.stringify(res.touched)}`);
    return [expected, res.counts];
  });
  // Per-id: each recent order alone — the counts it reports must equal the markers'.
  let perId = 0;
  const markers = await markerCounts(new Date());
  for (const id of recentOrders.slice(0, 40)) {
    const res = await billingSync(body({ orderIds: [id] }), ALL);
    for (const [k, v] of Object.entries(res.counts)) {
      perId++;
      if (v !== markers[k as keyof typeof markers]) {
        await compare(`order ${id} → ${k} count`, async () => [(await markerCounts(new Date()))[k as keyof typeof markers], (await billingSync(body({ orderIds: [id] }), ALL)).counts[k as keyof typeof markers]]);
      }
    }
  }
  console.log(`    per-id: ${Math.min(40, recentOrders.length)} single-order calls, ${perId} counts checked against the markers`);

  console.log("\n3. Unrelated ids → nothing touched");
  const [unrelated] = await prisma.$queryRaw<{ id: number }[]>`
    SELECT o.id FROM orders o
     WHERE o."workflowStage" NOT IN ('pick_checked','dispatched','cancelled')
       AND (o."invoicedAt" IS NULL OR o."invoicedAt" < now() - interval '2 days')
       AND (o."soNumber" IS NULL OR (SELECT count(*) FROM orders x WHERE x."soNumber" = o."soNumber") = 1)
       AND NOT EXISTS (SELECT 1 FROM so_tag_matches m WHERE m."orderId" = o.id)
     ORDER BY o.id DESC LIMIT 1`;
  const [unrelatedTrip] = await prisma.$queryRaw<{ id: number }[]>`
    SELECT t.id FROM trips t
     WHERE t."sentToBillingAt" IS NULL
       AND NOT EXISTS (SELECT 1 FROM trip_activity a WHERE a."tripId" = t.id
                        AND a.action IN ('sent_to_billing','taken_back_from_billing'))
     ORDER BY t.id DESC LIMIT 1`;
  console.log(`    unrelated order ${unrelated?.id ?? "(none found)"}, unrelated trip ${unrelatedTrip?.id ?? "(none found)"}`);
  if (unrelated && unrelatedTrip) {
    await compare("unrelated order + trip → all touched=false, no counts", async () => [
      { touched: { picking: false, print: false, telephonic: false, pickDelete: false, mailOrders: false }, counts: {} },
      await billingSync(body({ orderIds: [unrelated.id], tripIds: [unrelatedTrip.id] }), ALL),
    ]);
  } else {
    diffs.push("could not find an unrelated order/trip to test");
  }
  await compare("empty batch → nothing touched", async () => [
    { touched: { picking: false, print: false, telephonic: false, pickDelete: false, mailOrders: false }, counts: {} },
    await billingSync(body({}), ALL),
  ]);
  await compare("no permission on any arm → nothing touched even for 'everything'", async () => [
    { touched: { picking: false, print: false, telephonic: false, pickDelete: false, mailOrders: false }, counts: {} },
    await billingSync(everything, { picking: false, print: false, telephonic: false, pickDelete: false, mailOrders: false }),
  ]);

  console.log("\nTiming — classifier on the real batch (3 runs)");
  const tt: number[] = [];
  for (let i = 0; i < 3; i++) {
    const s = Date.now();
    await classifyBillingSync(body({ orderIds: recentOrders, tripIds: recentTrips }), ALL);
    tt.push(Date.now() - s);
  }
  console.log(`    ${tt.join(" / ")} ms`);

  console.log(`\n${compared} comparisons, ${diffs.length} difference(s).`);
  for (const d of diffs) console.log(`  DIFF: ${d}`);
  await prisma.$disconnect();
  process.exit(diffs.length > 0 ? 1 : 0);
})();
