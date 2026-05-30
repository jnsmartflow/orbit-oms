// Phase 4 spec §2.8 — on Mark Done, write one sampling_usage_log row per TI
// entry (TINTER + ACOTONE) + bump sampling_recipes.usageCount + lastUsedAt.
//
// CORE §3: sequential awaits only, no $transaction. Per-row try/catch so a
// single failure cannot fail Mark Done. Returns counters so the route can
// surface visibility into how many rows landed, were skipped, or failed.

import { prisma } from "@/lib/prisma";

/**
 * Returns a Date pinned to today in IST at midnight UTC. Suitable for both
 * `sampling_usage_log.usageDate` (DATE column — truncates to day on store)
 * and `sampling_recipes.lastUsedAt` (TIMESTAMP — lands as YYYY-MM-DD 00:00).
 * Spec uses 5.5h IST offset to roll the day boundary correctly even when
 * the JS engine's UTC clock is hours behind IST.
 */
export function getIstUsageDate(): Date {
  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const isoDay = istNow.toISOString().split("T")[0]; // "YYYY-MM-DD"
  return new Date(isoDay);
}

interface UsageLogArgs {
  tintAssignmentId:   number;
  obdNumber:          string;
  shipToCustomerName: string | null;
  operatorId:         number;
  usageDate:          Date;
  // The order's resolved ship-to delivery-point id (orders.customerId →
  // delivery_point_master.id). Written to sampling_usage_log.siteId so the
  // site-based /suggest query can match these rows. Optional/nullable: when
  // the order's ship-to is unresolved we fall back to sampling_register.siteId.
  siteId?:            number | null;
}

export interface UsageLogResult {
  // usageLogRows — successfully inserted sampling_usage_log rows.
  written: number;
  // usageLogSkipped — INTENTIONAL skips. Cause: TI row has samplingNo=null
  // (defensive; shouldn't happen post-Phase-4 but the column is nullable).
  skipped: number;
  // usageLogFailed — UNEXPECTED throws inside the per-row try/catch. The
  // row's recipe lookup, log insert, or recipe bump threw and was logged.
  // Distinct from `skipped` so the route can surface both signals.
  failed:  number;
}

export async function writeUsageLogsForAssignment(
  args: UsageLogArgs,
): Promise<UsageLogResult> {
  const { tintAssignmentId, obdNumber, shipToCustomerName, operatorId, usageDate, siteId } = args;

  // ── Fetch TINTER + ACOTONE TI rows for this assignment ───────────────────
  const tinterRows = await prisma.tinter_issue_entries.findMany({
    where:  { tintAssignmentId },
    select: { id: true, samplingNo: true, baseSku: true, packCode: true, tinQty: true },
  });
  const acotoneRows = await prisma.tinter_issue_entries_b.findMany({
    where:  { tintAssignmentId },
    select: { id: true, samplingNo: true, baseSku: true, packCode: true, tinQty: true },
  });

  // ── Best-effort dealer lookup ────────────────────────────────────────────
  const summary = await prisma.import_raw_summary.findFirst({
    where:  { obdNumber },
    select: { billToCustomerName: true },
  });
  const dealerNameRaw = summary?.billToCustomerName ?? null;

  let written = 0;
  let skipped = 0;
  let failed  = 0;

  // Combined loop so both tables fire in the same Mark Done call.
  const allRows: Array<{ table: "TINTER" | "ACOTONE"; row: typeof tinterRows[number] }> = [
    ...tinterRows.map((row)  => ({ table: "TINTER"  as const, row })),
    ...acotoneRows.map((row) => ({ table: "ACOTONE" as const, row })),
  ];

  for (const { table, row } of allRows) {
    if (row.samplingNo === null) {
      console.warn(`[done/usage-log] ${table} TI ${row.id} has no samplingNo. Skipping.`);
      skipped += 1;
      continue;
    }

    try {
      // Resolve recipeId. Allowed to be null per schema; log warning when
      // we expected a match but didn't find one.
      let recipeId: number | null = null;
      if (row.packCode) {
        const recipe = await prisma.sampling_recipes.findFirst({
          where:  { samplingNo: row.samplingNo, skuCode: row.baseSku, packCode: row.packCode },
          select: { id: true },
        });
        if (recipe) {
          recipeId = recipe.id;
        } else {
          console.warn(
            `[done/usage-log] no recipe variant found for samplingNo=${row.samplingNo} sku=${row.baseSku} pack=${row.packCode} (${table} TI ${row.id})`,
          );
        }
      }

      // Resolve siteId. Prefer the order's resolved ship-to delivery-point id
      // (passed from the call site). When that is null/undefined, fall back to
      // the parent sampling_register.siteId for this samplingNo so the row
      // still matches the site-based /suggest query.
      let resolvedSiteId: number | null = siteId ?? null;
      if (resolvedSiteId === null) {
        const register = await prisma.sampling_register.findUnique({
          where:  { samplingNo: row.samplingNo },
          select: { siteId: true },
        });
        resolvedSiteId = register?.siteId ?? null;
      }

      await prisma.sampling_usage_log.create({
        data: {
          samplingNo:      row.samplingNo,
          recipeId,
          usageDate,
          operatorId,
          operatorNameRaw: null,
          tinQty:          row.tinQty,
          dealerNameRaw,
          siteId:          resolvedSiteId,
          siteNameRaw:     shipToCustomerName,
          skuCodeRaw:      row.baseSku,
          packCode:        row.packCode,
          sourceRowIndex:  null,
          deliveryNumber:  obdNumber,
        },
      });
      written += 1;

      // Bump usageCount + lastUsedAt on the recipe variant. Only when
      // resolved — recipeId=null means no variant to bump.
      if (recipeId !== null) {
        await prisma.sampling_recipes.update({
          where: { id: recipeId },
          data:  { usageCount: { increment: 1 }, lastUsedAt: usageDate },
        });
      }
    } catch (err) {
      console.warn(
        `[done/usage-log] failed for ${table} TI ${row.id} (samplingNo=${row.samplingNo}, sku=${row.baseSku}, pack=${row.packCode}):`,
        err instanceof Error ? err.message : String(err),
      );
      failed += 1;
    }
  }

  return { written, skipped, failed };
}
