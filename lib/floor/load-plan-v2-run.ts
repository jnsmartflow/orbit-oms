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
          where: { id: { in: req.orderIds }, isRemoved: false, tripDropId: null },
          select: {
            id: true,
            customerId: true,
            shipToOverrideCustomerId: true,
            shipToCustomerId: true,
            dispatchTargetDate: true,
            querySnapshot: { select: { totalWeight: true } },
            customer: dealerSelect,
            shipToOverrideCustomer: dealerSelect,
          },
        });

  const todayMs = istTodayDateOnly().getTime();
  const bills: V2Bill[] = [];
  for (const o of orders) {
    const dealer = o.shipToOverrideCustomer ?? o.customer;
    if (dealer?.area?.deliveryType?.name !== "Upcountry") continue;
    const due = o.dispatchTargetDate;
    const ageDays = due === null ? 0 : Math.max(0, Math.floor((todayMs - due.getTime()) / MS_PER_DAY));
    bills.push({
      orderId: o.id,
      weightKg: o.querySnapshot?.totalWeight ?? null,
      stopKey: computeDropKey(o),
      areaId: dealer.areaId,
      routeId: dealer.area.primaryRouteId,
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
