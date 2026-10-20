// lib/floor/load-plan-v2-run.ts — SERVER ONLY (2026-09-21).
//
// Runs the Upcountry load plan v2 (lib/trips/load-plan-v2.ts) on the bills the
// Load plan tab shows. The screen sends the ids of its DUE pool; this re-reads
// every bill here — its effective ship-to's area and route, its weight, its
// stop, whether it is overdue — and keeps only the ones that are still
// Upcountry, not removed and on no trip. The screen never supplies a weight,
// an area or a rate.
//
// 🔴 RATES ARE SECRET (CLAUDE_CORE.md §7.19). The context (rates, pairs) is
// read and used here only. What this returns is the engine's OUTPUT — kg,
// stops, places, reasons — plus the locked kg / stop limits. No rupee value.
//
// Sequential awaits; never prisma.$transaction (CORE §3). READ-ONLY.

import { prisma } from "@/lib/prisma";
import { computeDropKey } from "@/lib/trips/drop-key";
import { effectiveArea, isTypedShipTo } from "@/lib/ship-to/effective";
import { isGiftBill, loadKg } from "@/lib/orders/gift";
import { loadSplitInvoiceRows } from "@/lib/order-invoices/invoice-load";
import { placeLoad } from "@/lib/floor/invoice-rows";
import { loadPlanV2Context } from "@/lib/floor/load-plan-v2-loader";
import { planLoadsV2, VEHICLE_TYPES, type AvailableVehicle, type V2Bill, type V2Plan, type VehicleType } from "@/lib/trips/load-plan-v2";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The kg and stop limits the cards draw their fill bar against — no money. */
export type V2Limits = Record<VehicleType, { idealKg: number; hardKg: number; idealStops: number; maxStops: number }>;

export interface LoadPlanV2Response {
  /** null = v2 is not set up (no config row, or its tables are missing). */
  plan: V2Plan | null;
  limits: V2Limits | null;
}

export interface LoadPlanV2Request {
  orderIds: number[];
  /** Plan bills already on a trip too (the 21:00 snapshot of the whole day). Default: pending bills only. */
  includeOnTrips?: boolean;
  available?: AvailableVehicle[];
  pinned?: string[];
  waiting?: string[];
}

function istTodayDateOnly(): Date {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

export async function runLoadPlanV2(req: LoadPlanV2Request): Promise<LoadPlanV2Response> {
  const ctx = await loadPlanV2Context("Upcountry");
  if (!ctx) return { plan: null, limits: null };

  const dealerSelect = {
    select: { areaId: true, area: { select: { primaryRouteId: true, deliveryType: { select: { name: true } } } } },
  } as const;
  const orders =
    req.orderIds.length === 0
      ? []
      : await prisma.orders.findMany({
          // handAt: null — a bill the dealer collects never rides a truck, so it
          // is never planned (2026-09-24, design §4). Server-side, so it also
          // covers the 21:00 snapshot cron.
          where: { id: { in: req.orderIds }, isRemoved: false, handAt: null, ...(req.includeOnTrips ? {} : { tripDropId: null }) },
          select: {
            id: true,
            obdNumber: true,
            customerId: true,
            shipToOverrideCustomerId: true,
            shipToCustomerId: true,
            // The typed ship-to (v27.73) — computeDropKey's t: branch needs both.
            shipToText: true,
            shipToAreaId: true,
            dispatchTargetDate: true,
            materialType: true,
            querySnapshot: { select: { totalWeight: true } },
            customer: dealerSelect,
            shipToOverrideCustomer: dealerSelect,
          },
        });

  // A SPLIT OBD plans only its invoices on NO trip (Phase 5 commit 1) — the
  // ones still to load. Wholly in To plan (or not split) → its own kg.
  const splitRows = await loadSplitInvoiceRows(
    orders,
    new Map(orders.map((o) => [o.id, o.querySnapshot?.totalWeight ?? null] as const)),
  );
  // A TYPED ship-to (v27.73, step 7A) plans under its PICKED area — routing
  // follows the typed area everywhere (owner, 2026-10-20). One read of those
  // areas, none when no bill is typed.
  const typedIds = Array.from(
    new Set(orders.filter((o) => isTypedShipTo(o) && o.shipToAreaId !== null).map((o) => o.shipToAreaId as number)),
  );
  const typedAreas = typedIds.length
    ? await prisma.area_master.findMany({
        where: { id: { in: typedIds } },
        select: { id: true, primaryRouteId: true, deliveryType: { select: { name: true } } },
      })
    : [];
  const typedById = new Map(typedAreas.map((a) => [a.id, { areaId: a.id, area: a }]));

  const todayMs = istTodayDateOnly().getTime();
  const bills: V2Bill[] = [];
  for (const o of orders) {
    // The place the bill goes: { areaId, area } of the typed area or the dealer.
    const place = effectiveArea(
      o,
      o.shipToAreaId !== null ? (typedById.get(o.shipToAreaId) ?? null) : null,
      o.shipToOverrideCustomer ?? o.customer,
    );
    if (place?.area?.deliveryType?.name !== "Upcountry") continue;
    const due = o.dispatchTargetDate;
    const ageDays = due === null ? 0 : Math.max(0, Math.floor((todayMs - due.getTime()) / MS_PER_DAY));
    bills.push({
      orderId: o.id,
      // A GIFT packs as 0 kg and keeps its stop (lib/orders/gift.ts).
      weightKg: loadKg(
        (() => {
          const rows = splitRows.get(o.id);
          const load = rows ? placeLoad(rows, (d) => d === null) : null;
          return load ? load.kg : o.querySnapshot?.totalWeight;
        })(),
        isGiftBill(o.materialType),
      ),
      stopKey: computeDropKey(o),
      areaId: place.areaId,
      routeId: place.area.primaryRouteId,
      overdue: ageDays > 0,
      ageDays,
    });
  }

  const plan = planLoadsV2(bills, ctx, {}, {
    ...(req.available ? { available: req.available } : {}),
    ...(req.pinned ? { pinned: req.pinned } : {}),
    ...(req.waiting ? { waiting: req.waiting } : {}),
  });
  const V = ctx.config.vehicles;
  const limits = {} as V2Limits;
  VEHICLE_TYPES.forEach((t) => {
    limits[t] = { idealKg: V[t].maxKg, hardKg: V[t].hardMaxKg ?? V[t].maxKg + V[t].overKg, idealStops: V[t].idealStops, maxStops: V[t].maxStops };
  });
  return { plan, limits };
}
