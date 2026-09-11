// scripts/backfill-nts-trips-2026-09-11.ts
//
// ONE-TIME BACKFILL — build real Orbit trips for bills that physically went out
// on an NTS truck but have no trip in Orbit.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS
//
// A cutover on 2026-09-11 closed 2,624 historical bills to `dispatched`. What
// remained in the "not on truck" pile were bills that are genuinely finished and
// genuinely shipped — NTS's trip_report mirror has them on a truck, with a
// vehicle and a driver — but Orbit never had a trip to attach them to. The right
// fix is to give them a trip sticker, not to relabel their stage again.
//
// 🔴 NTS TELLS US ONE THING ONLY: WHICH BILLS SHARED A TRUCK, plus the vehicle
// and driver. Everything else comes from Orbit. In particular the DROPS are
// built from Orbit's own customer FKs through `computeDropKey`, never from
// NTS's `custCode` — that column is a different id space and matching on it
// would silently split or merge stops.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 WHAT THIS SCRIPT DELIBERATELY DOES NOT DO
//
// IT DOES NOT CALL `releaseBillsToFloor` AND MUST NEVER LEARN TO. The normal
// confirm path (app/api/floor/trips/[id]/release/route.ts) calls it, because in
// the normal flow a trip's bills are waiting at the desk and confirming the plan
// is what sends them to the floor. These 74 bills are already `pick_checked` —
// picked, checked, signed off and physically gone. Pushing them to the floor
// again would move finished work backwards onto a live board.
//
// So this script writes EXACTLY THREE THINGS and nothing else:
//   1. one `trips` row per NTS group
//   2. its `trip_drops` rows
//   3. `orders.tripDropId` — ONE `orders.update` per bill, that column alone
//
// It does NOT write `workflowStage`. It does NOT write `dispatchStatus`. It
// writes no `order_status_logs` row, sends no notification, and calls nothing in
// lib/floor/release.ts. Verified by inspection of this file's imports: the only
// lib it reaches into are lib/trips/number.ts and lib/trips/drop-key.ts.
//
// ⚠ ONE `orders.update` PER BILL is not a style rule. The live-sync markers key
// on MAX(orders.updatedAt), so a second write per bill fires a false "changed"
// on every board in the depot (CORE §3, FLOOR §10, PICKING §10).
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 status = 'released', NOT 'confirmed'
//
// The brief asked for `confirmed`. There is no such value. `chk_trips_status`
// admits exactly draft | released | loading | dispatched | cancelled, so an
// insert with 'confirmed' is rejected by the database. "Confirmed" is UI WORDING
// — lib/floor/trip-wording.ts renders the same stored 'released' as "Confirm
// plan"/"Confirmed" with the picking gate off and "Release to floor"/"Released"
// with it on. The stored value is 'released' either way.
//
// `releasedAt` and `releasedById` are set with it. No CHECK forces that (only
// `cancelled` and `dispatched` have completeness constraints), but a released
// trip with no release stamp is a half-written row and the trip header renders
// the who-line from it.
//
// ═══════════════════════════════════════════════════════════════════════════
// RE-RUNNABLE. The candidate query requires `tripDropId IS NULL`, so a bill
// already placed is never a candidate. A group whose bills have all been placed
// yields an empty candidate list and is skipped before any trip is created —
// so a second run creates no empty trips and no duplicates.
//
// NOT DATE-FENCED, deliberately. The cutover already removed everything older,
// so `pick_checked AND tripDropId IS NULL` is self-correcting: whatever is left
// is what still needs a truck.
//
// Sequential awaits throughout, never prisma.$transaction (CORE §3 — Vercel
// serverless + the Supabase pooler time out on it).
//
// Run:  npx tsx scripts/backfill-nts-trips-2026-09-11.ts
//       npx tsx scripts/backfill-nts-trips-2026-09-11.ts --dry-run
// ═══════════════════════════════════════════════════════════════════════════

import { PrismaClient } from "@prisma/client";
import { allocateTripNumberWithRetry } from "../lib/trips/number";
import { computeDropKey } from "../lib/trips/drop-key";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

/**
 * The actor on every row this script writes.
 *
 * id 1 = admin@orbitoms.in ("Harsh"), isSuperuser. NOT invented: it already
 * carries 4 of the 12 cancelled trips in the table, so the audit trail stays
 * consistent with what a human has already done here.
 */
const ACTOR_ID = 1;

/**
 * NTS `deliveryType` → Orbit typeCode + deliveryTypeId.
 *
 * 🔴 READ FROM THE LIVE TABLE, NOT SEED. delivery_type_master live on
 * 2026-09-11: 1 Local, 2 Upcountry, 5 IGT, 6 Cross. The ids are resolved by
 * NAME at run time below rather than hardcoded, so a reseeded environment
 * cannot silently file a trip under the wrong type.
 *
 * ⚠ 'UPC' IS THE REAL STORED VALUE for Up-Country — confirmed against the live
 * mirror (1,857 + 149 rows), and it matches CLAUDE_TRIP_REPORT.md §4. It is NOT
 * spelled "Upcountry" in trip_report.
 *
 * ⚠ `fixedType` IS NOT A TYPE and must not be used for this. Both of its values
 * appear under both labels in live data.
 */
const TYPE_MAP: Record<string, { typeCode: string; deliveryTypeName: string }> = {
  Local: { typeCode: "L", deliveryTypeName: "Local" },
  UPC: { typeCode: "U", deliveryTypeName: "Upcountry" },
};

/** Plate comparison: case-insensitive, spaces and hyphens stripped. */
function normalisePlate(plate: string): string {
  return plate.toUpperCase().replace(/[\s-]/g, "");
}

interface Candidate {
  orderId: number;
  obdNumber: string;
  customerId: number | null;
  shipToCustomerId: string;
  shipToOverrideCustomerId: number | null;
  customerName: string | null;
  areaName: string | null;
  routeName: string | null;
  tripNo: string;
  disDate: Date;
  deliveryType: string | null;
  vehicleNo: string | null;
  driverName: string | null;
  driverMobile: string | null;
}

interface SkipReason {
  group: string;
  reason: string;
  obdNumbers: string[];
}

async function main() {
  const started = Date.now();
  console.log(`\n${"=".repeat(74)}`);
  console.log(`NTS TRIP BACKFILL  ${DRY_RUN ? "· DRY RUN — nothing will be written" : "· LIVE"}`);
  console.log("=".repeat(74));

  // ── 1 · the live master data, resolved by name ───────────────────────────
  const deliveryTypes = await prisma.delivery_type_master.findMany({
    select: { id: true, name: true },
  });
  const deliveryTypeIdByName = new Map(deliveryTypes.map((d) => [d.name, d.id]));

  const vehicles = await prisma.vehicle_master.findMany({
    select: { id: true, vehicleNo: true, transporterId: true },
  });
  const vehicleByPlate = new Map(vehicles.map((v) => [normalisePlate(v.vehicleNo), v]));

  console.log(
    `\nmaster data — ${deliveryTypes.length} delivery types, ${vehicles.length} vehicles`,
  );

  // ── 2 · the candidates ───────────────────────────────────────────────────
  //
  // Raw SQL because the join is orders → trip_report ON deliveryNo = obdNumber,
  // and there is no Prisma relation between them (trip_report is an NTS mirror
  // with no FK into orders — CLAUDE_TRIP_REPORT.md §2). SELECT only.
  //
  // The customer fields come from Orbit's own masters, resolved through the
  // SAME fallback `effectiveCustomerId` uses: override first, plain second.
  const candidates = await prisma.$queryRawUnsafe<Candidate[]>(`
    SELECT o.id                            AS "orderId",
           o."obdNumber",
           o."customerId",
           o."shipToCustomerId",
           o."shipToOverrideCustomerId",
           COALESCE(dpo."customerName", dp."customerName", o."shipToCustomerName") AS "customerName",
           COALESCE(ao.name, a.name)       AS "areaName",
           COALESCE(ro.name, r.name)       AS "routeName",
           t."tripNo",
           t."disDate",
           t."deliveryType",
           t."vehicleNo",
           t."driverName",
           t."driverMobile"
      FROM orders o
      JOIN trip_report t            ON t."deliveryNo" = o."obdNumber"
      LEFT JOIN delivery_point_master dp  ON dp.id = o."customerId"
      LEFT JOIN delivery_point_master dpo ON dpo.id = o."shipToOverrideCustomerId"
      LEFT JOIN area_master a   ON a.id  = dp."areaId"
      LEFT JOIN area_master ao  ON ao.id = dpo."areaId"
      LEFT JOIN route_master r  ON r.id  = a."primaryRouteId"
      LEFT JOIN route_master ro ON ro.id = ao."primaryRouteId"
     WHERE o."isRemoved"      = false
       AND o."workflowStage"  = 'pick_checked'
       AND o."tripDropId"     IS NULL
       AND o."dispatchStatus" IS DISTINCT FROM 'hold'
     ORDER BY t."disDate", t."tripNo", o.id;
  `);

  console.log(`candidates — ${candidates.length} bills\n`);
  if (candidates.length === 0) {
    console.log("Nothing to do. Every eligible bill is already on a trip.");
    return;
  }

  // ── 3 · group by the NTS (tripNo, disDate) ───────────────────────────────
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const key = `${c.tripNo}|${c.disDate.toISOString().slice(0, 10)}`;
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }
  console.log(`grouped into ${groups.size} NTS trips\n`);

  const skipped: SkipReason[] = [];
  const created: Array<{
    tripNumber: string;
    tripDate: string;
    typeCode: string;
    vehicle: string;
    vehicleField: "vehicleId" | "adhocVehicleNo";
    driver: string | null;
    ntsTripNo: string;
    drops: number;
    bills: number;
  }> = [];
  let billsPlaced = 0;

  // ── 4 · one trip per group ───────────────────────────────────────────────
  for (const [key, rows] of Array.from(groups.entries())) {
    const [ntsTripNo, disDateIso] = key.split("|");
    const obdNumbers = rows.map((r) => r.obdNumber);

    // (a) TYPE. 🔴 A MIXED GROUP IS SKIPPED, NEVER GUESSED. One truck carrying
    //     rows labelled both Local and UPC is a real NTS data state (L237 on
    //     2026-09-11) and only a human can say which it was. Picking the
    //     majority would file a trip under a type the depot did not run.
    const distinctTypes = Array.from(new Set(rows.map((r) => r.deliveryType)));
    if (distinctTypes.length !== 1) {
      skipped.push({
        group: `${ntsTripNo} / ${disDateIso}`,
        reason: `NTS rows disagree on deliveryType (${distinctTypes.join(" + ")}) — a human must decide`,
        obdNumbers,
      });
      continue;
    }
    const ntsType = distinctTypes[0];
    const mapped = ntsType ? TYPE_MAP[ntsType] : undefined;
    if (!mapped) {
      skipped.push({
        group: `${ntsTripNo} / ${disDateIso}`,
        reason: `deliveryType "${ntsType ?? "(null)"}" is out of scope — only Local and UPC are handled`,
        obdNumbers,
      });
      continue;
    }
    const deliveryTypeId = deliveryTypeIdByName.get(mapped.deliveryTypeName);
    if (deliveryTypeId === undefined) {
      skipped.push({
        group: `${ntsTripNo} / ${disDateIso}`,
        reason: `no live delivery_type_master row named "${mapped.deliveryTypeName}"`,
        obdNumbers,
      });
      continue;
    }

    // (b) VEHICLE. 🔴 EXACTLY ONE OF vehicleId / adhocVehicleNo —
    //     `chk_trips_vehicle_one_of` refuses both and refuses neither being set
    //     alongside a claim to the other. A plate in the master becomes the FK;
    //     one that is not becomes the free-text plate, which is what that column
    //     exists for.
    const distinctVehicles = Array.from(
      new Set(rows.map((r) => r.vehicleNo).filter(Boolean) as string[]),
    );
    if (distinctVehicles.length !== 1) {
      skipped.push({
        group: `${ntsTripNo} / ${disDateIso}`,
        reason:
          distinctVehicles.length === 0
            ? "NTS carries no vehicle number for this trip"
            : `NTS rows disagree on the vehicle (${distinctVehicles.join(", ")})`,
        obdNumbers,
      });
      continue;
    }
    const ntsPlate = distinctVehicles[0];
    const master = vehicleByPlate.get(normalisePlate(ntsPlate));

    // (c) DRIVER + TRANSPORTER. The driver is SNAPSHOTTED onto the trip rather
    //     than read through vehicleId, exactly as the schema record requires: a
    //     master driver changes when the depot reassigns a van, and a trip that
    //     already ran must keep the person who actually drove it. Taken from
    //     NTS, which is the only record of who drove this particular load.
    //     The transporter comes from Orbit's vehicle master, not NTS's text.
    const driverName = rows.find((r) => r.driverName)?.driverName ?? null;
    const driverPhone = rows.find((r) => r.driverMobile)?.driverMobile ?? null;
    const transporterId = master?.transporterId ?? null;

    // (d) DROPS, from ORBIT. `computeDropKey` is the one owner of the rule —
    //     'c:'+customerId when a customer resolves, 's:'+shipToCode when it does
    //     not. The prefix is load-bearing: two id spaces would otherwise collide.
    const dropsByKey = new Map<string, Candidate[]>();
    for (const r of rows) {
      const dropKey = computeDropKey({
        customerId: r.customerId,
        shipToCustomerId: r.shipToCustomerId,
        shipToOverrideCustomerId: r.shipToOverrideCustomerId,
      });
      const arr = dropsByKey.get(dropKey) ?? [];
      arr.push(r);
      dropsByKey.set(dropKey, arr);
    }

    const tripDate = new Date(`${disDateIso}T00:00:00.000Z`);
    const label =
      `${ntsTripNo} / ${disDateIso} · ${ntsType} · ${ntsPlate}` +
      ` · ${rows.length} bill(s), ${dropsByKey.size} stop(s)`;

    if (DRY_RUN) {
      console.log(`  WOULD CREATE  ${label}`);
      created.push({
        tripNumber: "(dry run)",
        tripDate: disDateIso,
        typeCode: mapped.typeCode,
        vehicle: ntsPlate,
        vehicleField: master ? "vehicleId" : "adhocVehicleNo",
        driver: driverName,
        ntsTripNo,
        drops: dropsByKey.size,
        bills: rows.length,
      });
      billsPlaced += rows.length;
      continue;
    }

    // ── THE WRITE ──────────────────────────────────────────────────────────
    // allocateTripNumberWithRetry reads MAX(seq)+1 for (tripDate, typeCode) with
    // NO status filter, so a cancelled trip still holds its number and cannot be
    // reissued — and retries once on a unique collision.
    try {
      const trip = await allocateTripNumberWithRetry(
        tripDate,
        mapped.typeCode,
        async (identity) =>
          prisma.trips.create({
            data: {
              tripNumber: identity.tripNumber,
              tripDate,
              typeCode: identity.typeCode,
              seq: identity.seq,
              deliveryTypeId,
              // 🔴 'released', NOT 'confirmed' — see the header. Stamped, because
              // a released trip with no release stamp is a half-written row.
              status: "released",
              releasedAt: new Date(),
              releasedById: ACTOR_ID,
              // Exactly one of the two, per chk_trips_vehicle_one_of.
              vehicleId: master?.id ?? null,
              adhocVehicleNo: master ? null : ntsPlate,
              transporterId,
              driverName,
              driverPhone,
              // The NTS trip number, kept so the two systems can be reconciled
              // by eye during the parallel run.
              transporterTripNo: ntsTripNo,
              note: `Backfilled from the NTS trip report (${ntsTripNo}, ${disDateIso})`,
              createdById: ACTOR_ID,
            },
            select: { id: true, tripNumber: true },
          }),
      );

      // Drops in a stable order — the map preserves first-seen, and the
      // candidate query is ordered by order id, so two runs produce the same
      // visit sequence. dropSeq is an ORDERING, never an index: gaps are legal
      // and uniqueness is on (tripId, dropSeq).
      let dropSeq = 0;
      for (const [dropKey, dropRows] of Array.from(dropsByKey.entries())) {
        dropSeq += 1;
        const head = dropRows[0];
        const drop = await prisma.trip_drops.create({
          data: {
            tripId: trip.id,
            dropSeq,
            dropKey,
            customerId: head.shipToOverrideCustomerId ?? head.customerId,
            shipToCode: head.shipToCustomerId,
            customerName: head.customerName ?? head.shipToCustomerId,
            areaName: head.areaName,
            routeName: head.routeName,
          },
          select: { id: true },
        });

        // ONE orders.update per bill, and it writes ONE COLUMN. No stage, no
        // status, no log row, no release. See the header.
        for (const r of dropRows) {
          await prisma.orders.update({
            where: { id: r.orderId },
            data: { tripDropId: drop.id },
          });
          billsPlaced += 1;
        }
      }

      created.push({
        tripNumber: trip.tripNumber,
        tripDate: disDateIso,
        typeCode: mapped.typeCode,
        vehicle: ntsPlate,
        vehicleField: master ? "vehicleId" : "adhocVehicleNo",
        driver: driverName,
        ntsTripNo,
        drops: dropsByKey.size,
        bills: rows.length,
      });
      console.log(`  created  ${trip.tripNumber}  ←  ${label}`);
    } catch (err) {
      // A failed group is REPORTED, never retried blindly and never allowed to
      // abort the rest. Its bills keep tripDropId NULL, so a re-run picks the
      // whole group up again from scratch.
      skipped.push({
        group: `${ntsTripNo} / ${disDateIso}`,
        reason: `write failed — ${err instanceof Error ? err.message : String(err)}`,
        obdNumbers,
      });
      console.error(`  FAILED   ${label}`);
    }
  }

  // ── 5 · the report ───────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(74)}\nRESULT\n${"=".repeat(74)}`);
  console.log(`\ntrips created: ${created.length}`);
  if (created.length > 0) console.table(created);

  console.log(`\nbills placed:  ${billsPlaced}`);
  console.log(`groups skipped: ${skipped.length}`);
  if (skipped.length > 0) {
    for (const s of skipped) {
      console.log(`\n  ${s.group}\n    reason: ${s.reason}\n    OBDs:   ${s.obdNumbers.join(", ")}`);
    }
  }

  // The pile, after.
  const pile = await prisma.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*)::int AS not_on_truck,
           COUNT(*) FILTER (WHERE "dispatchStatus" = 'hold')::int AS of_which_hold
      FROM orders
     WHERE "isRemoved" = false AND "workflowStage" = 'pick_checked' AND "tripDropId" IS NULL;`);
  console.log(`\n"not on truck" pile now:`);
  console.table(pile);

  // 🔴 THE PROOF THAT NOTHING ELSE MOVED. Every bill this script touched must
  // still be pick_checked and must still carry the dispatchStatus it arrived
  // with. If either number is anything but the placed count, stop and read.
  const proof = await prisma.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*)::int AS bills_on_a_backfilled_trip,
           COUNT(*) FILTER (WHERE o."workflowStage" = 'pick_checked')::int   AS still_pick_checked,
           COUNT(*) FILTER (WHERE o."dispatchStatus" = 'dispatch')::int      AS status_dispatch,
           COUNT(*) FILTER (WHERE o."dispatchStatus" IS NULL)::int           AS status_null,
           COUNT(*) FILTER (WHERE o."dispatchStatus" = 'hold')::int          AS status_hold
      FROM orders o
      JOIN trip_drops d ON d.id = o."tripDropId"
      JOIN trips t      ON t.id = d."tripId"
     WHERE t.note LIKE 'Backfilled from the NTS trip report%';`);
  console.log(`\nstage / status proof — every placed bill must still be pick_checked:`);
  console.table(proof);

  console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main()
  .catch((e) => {
    console.error("\nBACKFILL FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
