// Floor Control — LOAD PLAN CONFIG, the read (2026-09-19).
//
// The rules the "Load plan" view packs by, one row per delivery type
// (load_plan_config, sql/2026-09-19-load-plan-config.sql), plus every route's
// name so a reason can name a route that has no bills today ("No open Navsari
// truck to join"). Rides GET /api/floor/board as the sibling key `loadPlan`,
// beside `routeClubs` — config, not board data; two small reads.
//
// 🔴 IT NEVER THROWS. The view says "Load plan not set up" when a type has no
// usable row, and the floor must load whatever state this table is in:
//   - the table does not exist yet (the SQL file not run) → no configs;
//   - a row's jsonb is malformed → that type is left out (and logged).
// A config problem is a missing view, never a missing board.
//
// Sequential awaits, never prisma.$transaction (CORE §3). READ-ONLY.

import { prisma } from "@/lib/prisma";
import { parseLoadPlanConfig, type LoadPlanConfig } from "@/lib/trips/load-plan";

export interface FloorLoadPlanPayload {
  /** Delivery type NAME (the string a row's `deliveryType` holds) → its rules. */
  configs: Record<string, LoadPlanConfig>;
  /** route_master id → name, every route. */
  routeNames: Record<number, string>;
}

export async function getLoadPlanPayload(): Promise<FloorLoadPlanPayload> {
  const configs: Record<string, LoadPlanConfig> = {};
  try {
    const rows = await prisma.load_plan_config.findMany({
      select: { config: true, deliveryType: { select: { name: true } } },
    });
    for (const r of rows) {
      const parsed = parseLoadPlanConfig(r.config);
      if (parsed) configs[r.deliveryType.name] = parsed;
      else console.warn(`[load-plan] config for "${r.deliveryType.name}" is malformed — the view will say "not set up"`);
    }
  } catch (err) {
    // Most likely the table is not there yet. Not an error for the board.
    console.warn("[load-plan] config not readable — the view will say \"not set up\":", err instanceof Error ? err.message : err);
  }

  const routeNames: Record<number, string> = {};
  const routes = await prisma.route_master.findMany({ select: { id: true, name: true } });
  for (const r of routes) routeNames[r.id] = r.name.trim();

  return { configs, routeNames };
}
