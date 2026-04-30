// lib/import-upsert/audit.ts
//
// Audit log formatting + bulk write to order_status_logs.
// order_status_logs has no `changeType` column — we encode the change kind as
// a "[change_type] ..." prefix in the `note` field. Greppable, no schema change.

import { prisma } from "../prisma";
import type { AppliedChangeType, ImportSource } from "./types";

export interface AuditEntry { type: AppliedChangeType; note: string }

/**
 * Build the canonical audit-note string for a single applied change.
 * Format: `[change_type] {detail} via {source} batch {batchRef}`.
 */
export function formatAuditNote(
  type:     AppliedChangeType,
  source:   ImportSource,
  batchRef: string,
  detail:   string,
): string {
  return `[${type}] ${detail} via ${source} batch ${batchRef}`;
}

/**
 * Bulk-insert audit rows into order_status_logs. order_status_logs.toStage is
 * non-null on the schema; we set it to the order's current workflowStage so
 * the row is structurally valid even though the audit is field-level rather
 * than a stage transition.
 *
 * No-ops cleanly for an empty entries array.
 */
export async function writeAuditLogs(
  orderId:       number,
  userId:        number,
  workflowStage: string,
  entries:       AuditEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  await prisma.order_status_logs.createMany({
    data: entries.map((e) => ({
      orderId,
      fromStage:   null,
      toStage:     workflowStage,
      changedById: userId,
      note:        e.note,
    })),
  });
}
