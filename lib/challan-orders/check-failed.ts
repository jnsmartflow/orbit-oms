// lib/challan-orders/check-failed.ts
//
// SLICE 6c (2026-10-07) — when an import could not read the challan link table, its
// bills were withheld from every release (reconcile.ts catchChallanObds `excludeAll`).
// This module makes that VISIBLE and RECOVERABLE without depending on the link table.
//
// THE RECORD: import_batches.status = CHALLAN_CHECK_FAILED_STATUS on that batch — one
// row per import, already written by every import path, no CHECK on the column (live,
// 2026-10-07), and readable when the link table is not. No DDL. Cleared back to
// "completed" by a successful Retry (app/api/import/obd/route.ts ?action=challan-check-retry).
//
// THE WITHHELD BILLS of a batch = its orders (orders.batchId — stamped on create, never
// changed) that are still undecided: pending_support, dispatchStatus null, not removed.
// A bill someone already released or held by hand drops out of the count on its own.
//
// Readers: GET /api/challan-orders/alerts (the strip on Floor and the Challan screen),
// GET /api/import/log (the import history keeps listing the batch).

import { prisma } from "@/lib/prisma";
import type { CheckFailedBatch } from "./check-failed-message";
export { checkFailedMessage, type CheckFailedBatch } from "./check-failed-message";

/** import_batches.status of an import whose challan check could not run. */
export const CHALLAN_CHECK_FAILED_STATUS = "challan_check_failed";

/** The final status an import path writes: normal "completed", or the flag. Pure. */
export function finalBatchStatus(challanCheckFailed: boolean): string {
  return challanCheckFailed ? CHALLAN_CHECK_FAILED_STATUS : "completed";
}

/**
 * TESTING ONLY — make catchChallanObds behave as if the link table could not be read.
 * Honoured ONLY when NODE_ENV is not "production" AND CHALLAN_CHECK_FORCE_FAIL=1, so it
 * can never fire on Vercel. ⚠ Local dev points at the production DATABASE — turning it on
 * locally and importing WILL withhold real rows; use fake OBDs only (see the update doc).
 */
export function challanCheckForcedToFail(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.CHALLAN_CHECK_FORCE_FAIL === "1";
}

/** Every flagged batch, oldest first, with its withheld count. Never reads the link table. */
export async function loadCheckFailedBatches(): Promise<CheckFailedBatch[]> {
  const batches = await prisma.import_batches.findMany({
    where: { status: CHALLAN_CHECK_FAILED_STATUS },
    orderBy: { createdAt: "asc" },
    select: { id: true, batchRef: true, createdAt: true },
  });
  const out: CheckFailedBatch[] = [];
  for (const b of batches) {
    const withheld = await prisma.orders.count({
      where: { batchId: b.id, isRemoved: false, workflowStage: "pending_support", dispatchStatus: null },
    });
    out.push({ batchId: b.id, batchRef: b.batchRef, createdAt: b.createdAt.toISOString(), withheld });
  }
  return out;
}
