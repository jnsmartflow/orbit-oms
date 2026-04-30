// lib/import-upsert/state.ts
//
// Read-side helpers: load existing order/summary/lines for an OBD, and
// resolve a customer code to a delivery_point_master id. Used by the main
// upsert function to decide between create and patch branches.

import { prisma } from "../prisma";
import type { ExistingOrder, ExistingLine, ExistingSummary } from "./types";

/**
 * Load the orders row, the earliest matching import_raw_summary, and all
 * import_raw_line_items belonging to that summary, in three sequential reads.
 *
 * Patches accumulate on the original (creating) summary rather than creating
 * a new summary per batch — keeps the data model simple and FK-stable.
 */
export async function loadExistingObd(obdNumber: string): Promise<{
  order:   ExistingOrder | null;
  summary: ExistingSummary | null;
  lines:   ExistingLine[];
}> {
  const order = await prisma.orders.findUnique({
    where: { obdNumber },
    select: {
      id: true, customerId: true, shipToCustomerName: true,
      customerMissing: true, orderType: true, workflowStage: true, slotId: true,
      invoiceNo: true, invoiceDate: true, soNumber: true,
      obdEmailDate: true, orderDateTime: true, smu: true, sapStatus: true,
      materialType: true, natureOfTransaction: true, warehouse: true,
      totalUnitQty: true, grossWeight: true, volume: true,
    },
  });
  if (!order) return { order: null, summary: null, lines: [] };

  const summary = await prisma.import_raw_summary.findFirst({
    where:   { obdNumber },
    orderBy: { id: "asc" },
    select:  { id: true, obdEmailTime: true, smuCode: true },
  });

  const lines = summary
    ? await prisma.import_raw_line_items.findMany({
        where:  { rawSummaryId: summary.id },
        select: {
          id: true, rawSummaryId: true, lineId: true, skuCodeRaw: true,
          unitQty: true, volumeLine: true, isTinting: true, lineStatus: true,
        },
      })
    : [];

  return { order, summary, lines };
}

/**
 * Resolve a SAP ship-to customer code to its delivery_point_master.id, or
 * null if the customer code is not on file. Used to flip customerMissing
 * when a previously-unknown customer is later recognised.
 */
export async function resolveCustomerId(
  shipToCustomerId: string | null,
): Promise<number | null> {
  if (!shipToCustomerId) return null;
  const c = await prisma.delivery_point_master.findFirst({
    where:  { customerCode: shipToCustomerId },
    select: { id: true },
  });
  return c?.id ?? null;
}
