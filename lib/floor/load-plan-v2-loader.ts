// lib/floor/load-plan-v2-loader.ts — SERVER ONLY (2026-09-21).
//
// Builds the LoadPlanV2Context the v2 engine (lib/trips/load-plan-v2.ts) plans
// with: the Upcountry v2 config, every area's rates, the area pairs, and area /
// route names. READ-ONLY; sequential awaits; never prisma.$transaction (CORE §3).
//
// 🔴 RATES ARE SECRET (CLAUDE_CORE.md §7.19). What this returns carries rates
// and must stay on the server: never return it from an API route or server
// action, never pass it to a client component, never log a rate. The engine's
// OUTPUT is what may travel — it holds no rupee value.
//
// ⚠ It imports prisma, which cannot be bundled for a browser, so a client
// import fails the build rather than leaking. No `server-only` package is
// installed in this repo; this is the guard.
//
// Returns null — never throws — when the config row, its v2 keys, or either
// table is missing: v2 is not set up, and the caller falls back.
//
// The tables are read with raw SELECTs because they have no Prisma model yet.
// Every query is a fixed string with no user input.

import { prisma } from "@/lib/prisma";
import { parseLoadPlanV2Config, type AreaInfo, type AreaRate, type LoadPlanV2Context } from "@/lib/trips/load-plan-v2";

export async function loadPlanV2Context(deliveryTypeName = "Upcountry"): Promise<LoadPlanV2Context | null> {
  try {
    const cfgRows = await prisma.load_plan_config.findMany({
      where: { deliveryType: { name: deliveryTypeName } },
      select: { config: true },
    });
    const config = cfgRows.length === 1 ? parseLoadPlanV2Config(cfgRows[0].config) : null;
    if (!config) return null;

    const rateRows = await prisma.$queryRaw<
      Array<{ areaId: number; gcRate: number | null; aceRate: number | null; bigRate: number | null; gcExtra: number | null; aceExtra: number | null; bigExtra: number | null; gcAllowed: boolean }>
    >`SELECT "areaId", "gcRate", "aceRate", "bigRate", "gcExtra", "aceExtra", "bigExtra", "gcAllowed" FROM load_plan_area_rate`;
    const rates = new Map<number, AreaRate>();
    rateRows.forEach((r) =>
      rates.set(r.areaId, {
        gcRate: r.gcRate, aceRate: r.aceRate, bigRate: r.bigRate,
        gcExtra: r.gcExtra, aceExtra: r.aceExtra, bigExtra: r.bigExtra,
        gcAllowed: r.gcAllowed,
      }),
    );

    const pairRows = await prisma.$queryRaw<Array<{ areaIdA: number; areaIdB: number; timesTogether: number }>>`
      SELECT "areaIdA", "areaIdB", "timesTogether" FROM load_plan_area_pair`;
    const pairs = new Map<string, number>();
    pairRows.forEach((p) => pairs.set(`${p.areaIdA}-${p.areaIdB}`, p.timesTogether));

    const areaRows = await prisma.area_master.findMany({ select: { id: true, name: true, primaryRouteId: true } });
    const areas = new Map<number, AreaInfo>();
    areaRows.forEach((a) => areas.set(a.id, { name: a.name.trim(), routeId: a.primaryRouteId }));

    const routeRows = await prisma.route_master.findMany({ select: { id: true, name: true } });
    const routeNames: Record<number, string> = {};
    routeRows.forEach((r) => (routeNames[r.id] = r.name.trim()));

    return { config, rates, pairs, areas, routeNames };
  } catch (err) {
    // No rate is in this message: only that the context could not be built.
    console.warn("[load-plan-v2] context not readable — v2 is not set up:", err instanceof Error ? err.message.split("\n")[0] : err);
    return null;
  }
}
