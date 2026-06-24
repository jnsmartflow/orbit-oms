// lib/import-upsert/header.ts
//
// Header-level patch: pure planner (patchHeader) + DB executor (applyHeaderPatch).
//
// Patch policy (per design item D, with user corrections 1-3 applied):
// - obdNumber, shipToCustomerId, batchId, workflowStage, orderType — locked.
// - customerId, customerMissing — flip together when a previously-missing
//   customer now resolves (caller passes resolvedCustomerId).
// - shipToCustomerName, soNumber, invoiceNo, invoiceDate, materialType,
//   natureOfTransaction, warehouse — patchable (NULL → value).
// - sapStatus — patchable (NULL → value), auto-import only. SAP file does
//   not include Status; it lives only on the LogisticsTracker source.
// - smu, smuCode — patchable from divisionResolved.
// - obdEmailDate — auto-import overrides any prior value (operator-picked
//   SAP dates are less authoritative than the official email timestamp);
//   manual-template / manual-sap are NULL → value only.
// - obdEmailTime — patchable on summary.
// - orderDateTime — patchable; computed from (post-patch) date+time.
// - slotId/dispatchSlot/originalSlotId — patchable for non-tint orders only.
// - priorityLevel — never read or written by upsertObd.

import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { mergeEmailDateTime, resolveSlotFromTime } from "./helpers";
import { resolveArrivalSlotId } from "../slots/slot-ruler";
import type {
  ExistingOrder,
  ExistingSummary,
  HeaderPatchEntry,
  HeaderPatchPlan,
  ImportSource,
  ObdInput,
} from "./types";

/**
 * Compute the header diff between an existing OBD and the incoming input.
 * Pure: no DB access. Returns the Prisma update inputs for both `orders`
 * and `import_raw_summary`, plus a list of audit entries that the caller
 * formats into `order_status_logs.note` strings.
 */
export function patchHeader(
  existing:           ExistingOrder,
  existingSummary:    ExistingSummary | null,
  incoming:           ObdInput,
  source:             ImportSource,
  divisionResolved:   { smu: string | null; smuCode: string | null },
  resolvedCustomerId: number | null,
): HeaderPatchPlan {
  const orderUpdate:   Record<string, unknown> = {};
  const summaryUpdate: Record<string, unknown> = {};
  const entries: HeaderPatchEntry[] = [];
  let customerResolved = false;

  const fillNull = <T>(
    field: string,
    oldVal: T | null | undefined,
    newVal: T | null | undefined,
    target: "order" | "summary",
  ): void => {
    if ((oldVal === null || oldVal === undefined) && newVal !== null && newVal !== undefined) {
      (target === "order" ? orderUpdate : summaryUpdate)[field] = newVal;
      entries.push({ field, oldValue: oldVal ?? null, newValue: newVal, type: "header_patched" });
    }
  };

  // Customer resolution transition.
  if (existing.customerMissing && resolvedCustomerId !== null) {
    orderUpdate.customerId      = resolvedCustomerId;
    orderUpdate.customerMissing = false;
    entries.push({ field: "customerId",      oldValue: null, newValue: resolvedCustomerId, type: "header_patched" });
    entries.push({ field: "customerMissing", oldValue: true, newValue: false,              type: "header_patched" });
    customerResolved = true;
  }
  fillNull("shipToCustomerName", existing.shipToCustomerName, incoming.shipToCustomerName, "order");

  fillNull("soNumber",            existing.soNumber,            incoming.soNumber,            "order");
  fillNull("invoiceNo",           existing.invoiceNo,           incoming.invoiceNo,           "order");
  fillNull("invoiceDate",         existing.invoiceDate,         incoming.invoiceDate,         "order");
  fillNull("materialType",        existing.materialType,        incoming.materialType,        "order");
  fillNull("natureOfTransaction", existing.natureOfTransaction, incoming.natureOfTransaction, "order");
  fillNull("warehouse",           existing.warehouse,           incoming.warehouse,           "order");

  if (source === "auto-import") {
    fillNull("sapStatus", existing.sapStatus, incoming.sapStatus, "order");
  }

  fillNull("smu",     existing.smu,                          divisionResolved.smu,     "order");
  fillNull("smuCode", existingSummary?.smuCode ?? null,      divisionResolved.smuCode, "summary");

  // obdEmailDate — auto-import may overwrite a non-null value; other sources
  // are NULL → value only (prevents two manual sources fighting each other).
  if (incoming.obdEmailDate) {
    if (existing.obdEmailDate === null) {
      orderUpdate.obdEmailDate = incoming.obdEmailDate;
      entries.push({
        field: "obdEmailDate", oldValue: null, newValue: incoming.obdEmailDate,
        type: "header_patched",
      });
    } else if (
      source === "auto-import" &&
      existing.obdEmailDate.getTime() !== incoming.obdEmailDate.getTime()
    ) {
      orderUpdate.obdEmailDate = incoming.obdEmailDate;
      entries.push({
        field: "obdEmailDate", oldValue: existing.obdEmailDate, newValue: incoming.obdEmailDate,
        type: "header_overwritten",
      });
    }
  }

  fillNull("obdEmailTime", existingSummary?.obdEmailTime ?? null, incoming.obdEmailTime, "summary");

  // orderDateTime — compute if currently null and we have date+time post-patch.
  if (existing.orderDateTime === null) {
    const newEmailDate = (orderUpdate.obdEmailDate as Date | undefined) ?? existing.obdEmailDate;
    const newEmailTime = (summaryUpdate.obdEmailTime as string | undefined)
      ?? existingSummary?.obdEmailTime ?? null;
    const merged = mergeEmailDateTime(newEmailDate, newEmailTime);
    if (merged) {
      orderUpdate.orderDateTime = merged;
      entries.push({ field: "orderDateTime", oldValue: null, newValue: merged, type: "header_patched" });
    }
  }

  // Slot — patchable NULL → value, non-tint only.
  if (existing.slotId === null && existing.orderType !== "tint") {
    const slotTime = (summaryUpdate.obdEmailTime as string | undefined)
      ?? existingSummary?.obdEmailTime ?? null;
    const slot = resolveSlotFromTime(slotTime);
    orderUpdate.slotId         = slot.slotId;
    orderUpdate.originalSlotId = slot.slotId;
    orderUpdate.dispatchSlot   = slot.dispatchSlot;
    const patchEmailDate = (orderUpdate.obdEmailDate as Date | undefined) ?? existing.obdEmailDate;
    const arrivalBase    = mergeEmailDateTime(patchEmailDate, slotTime);
    if (arrivalBase) orderUpdate.arrivalSlotId = resolveArrivalSlotId(arrivalBase);
    entries.push({ field: "slotId", oldValue: null, newValue: slot.slotId, type: "header_patched" });
  }

  return {
    orderUpdate:   orderUpdate as Prisma.ordersUpdateInput,
    summaryUpdate: summaryUpdate as Prisma.import_raw_summaryUpdateInput,
    entries,
    customerResolved,
  };
}

/**
 * Run the orders.update and import_raw_summary.update produced by
 * patchHeader. Sequential awaits, no transaction (CLAUDE_CORE.md §3).
 * No-ops cleanly when either side has nothing to write.
 */
export async function applyHeaderPatch(
  orderId:   number,
  summaryId: number | null,
  plan:      HeaderPatchPlan,
): Promise<void> {
  if (Object.keys(plan.orderUpdate).length > 0) {
    await prisma.orders.update({ where: { id: orderId }, data: plan.orderUpdate });
  }
  if (summaryId !== null && Object.keys(plan.summaryUpdate).length > 0) {
    await prisma.import_raw_summary.update({ where: { id: summaryId }, data: plan.summaryUpdate });
  }
}
