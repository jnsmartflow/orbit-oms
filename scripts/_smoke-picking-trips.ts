/**
 * READ-ONLY smoke — GET /api/picking/trips (slice 1, 2026-10-13).
 *
 * Calls getPickingTrips() directly against live data and prints what the
 * supervisor's Trips view would get. Then cross-checks every listed trip
 * against the Floor rail's own summary for the same trip (getTripsForDate —
 * the feed /api/floor/trips serves): the split buckets must add back up to
 * Floor's, and the route list must lead with Floor's main route.
 *
 * Two passes: LIVE (getPickingTrips — the gate as it really is) and, when the
 * gate is ON, a SIMULATED gate-OFF pass (buildPickingTrips(false)) so the
 * listing path is exercised against real trips without flipping the switch.
 *
 * Performs NO writes. Run: npx tsx scripts/_smoke-picking-trips.ts
 */
import "dotenv/config";
import { getPickingTrips, buildPickingTrips } from "@/lib/picking/trips-view";
import type { PickingTripsResult } from "@/lib/picking/types";
import { getTripsForDate, parseTripDate } from "@/lib/trips/queries";
import { prisma } from "@/lib/prisma";

async function main() {
  const live = await getPickingTrips();
  console.log("════ LIVE ════");
  await report(live);
  if (live.gateOn) {
    console.log("");
    console.log("════ SIMULATED gate OFF (read-only — the switch is not touched) ════");
    await report(await buildPickingTrips(false));
  }
}

async function report(res: PickingTripsResult) {
  console.log(`date ${res.date} · gate ${res.gateOn ? "ON" : "OFF"} · trips ${res.trips.length}`);
  console.log(
    `not on a trip: ${res.notOnTrip.bills} waiting bill(s)${res.notOnTrip.notPlannedYet ? " — not planned yet (hidden by the gate)" : ""}`,
  );
  console.log("");

  for (const t of res.trips) {
    const c = t.counts;
    console.log(
      `${t.tripNumber}  [${t.typeCode}${t.isHand ? " hand" : ""}]  cutoff ${t.cutoff ?? "—"} (sort ${t.cutoffSortOrder ?? "—"})  route ${t.routeLabel ?? "No route"}  stops ${t.stops}`,
    );
    console.log(
      `   vehicle ${t.vehiclePlate ?? "—"} · driver ${t.driverName ?? "—"} ${t.driverPhone ?? ""} · shown ${t.shownAt ?? "no"} · routes [${t.routes.join(", ")}]`,
    );
    console.log(
      `   waiting ${c.waiting} · locked ${c.lockedUpcoming} · tinting ${c.tinting} · picking ${c.picking} · needsCheck ${c.needsCheck} · checked ${c.checked} · held ${c.held} · other ${c.other} · total ${c.total} · members ${t.members.length}`,
    );
  }

  // ── Cross-check against Floor's summary of the same trips ─────────────────
  const today = parseTripDate(res.date);
  const floor = new Map((await getTripsForDate(today, today)).map((s) => [s.id, s]));
  let bad = 0;
  for (const t of res.trips) {
    const s = floor.get(t.id);
    if (!s) {
      console.log(`✗ ${t.tripNumber}: not in Floor's feed`);
      bad += 1;
      continue;
    }
    const c = t.counts;
    const checks: Array<[string, number, number]> = [
      ["waiting+locked = Floor waiting", c.waiting + c.lockedUpcoming, s.counts.waiting],
      ["picking = Floor withPicker", c.picking, s.counts.withPicker],
      ["needsCheck = Floor picked", c.needsCheck, s.counts.picked],
      ["checked = Floor checked", c.checked, s.counts.checked],
      ["held = Floor held", c.held, s.counts.held],
      ["tinting+other = Floor other", c.tinting + c.other, s.counts.other],
      ["total = Floor total", c.total, s.counts.total],
      ["members = total", t.members.length, c.total],
    ];
    for (const [label, mine, theirs] of checks) {
      if (mine !== theirs) {
        console.log(`✗ ${t.tripNumber}: ${label} — ${mine} vs ${theirs}`);
        bad += 1;
      }
    }
    if ((t.routes[0] ?? null) !== s.routeName) {
      console.log(`✗ ${t.tripNumber}: routes[0] ${t.routes[0]} vs Floor main route ${s.routeName}`);
      bad += 1;
    }
    if (t.routes.length !== (s.routeName === null ? 0 : s.routeExtraCount + 1)) {
      console.log(`✗ ${t.tripNumber}: ${t.routes.length} routes vs Floor "+${s.routeExtraCount}"`);
      bad += 1;
    }
  }

  // What the owner's filters left out, for the record.
  const left = Array.from(floor.values()).filter((s) => !res.trips.some((t) => t.id === s.id));
  console.log("");
  console.log(`Floor desk: ${floor.size} trip(s); not listed here: ${left.length}`);
  for (const s of left) {
    const why =
      s.status === "cancelled"
        ? "cancelled"
        : s.counts.total === 0
          ? "no bills"
          : res.gateOn && s.shownAt === null
            ? "not shown (gate ON)"
            : "?";
    console.log(`   ${s.tripNumber} — ${why} (bills ${s.counts.total}, waiting ${s.counts.waiting})`);
  }
  console.log("");
  console.log(bad === 0 ? "✓ every listed trip reconciles with Floor's summary" : `✗ ${bad} mismatch(es)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
