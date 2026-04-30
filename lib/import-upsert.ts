// lib/import-upsert.ts
//
// Shared upsert utility for OBD imports across all three sources:
// auto-import (PowerShell), manual-template (XLS upload), manual-sap (SAP punch).
//
// Pure logic — no HTTP, no auth, no file parsing. Returns the set of changes
// applied + downstream effects the caller should fire (mail-order enrichment,
// challan creation, query summary rebuild, etc.).
//
// Constraints honoured (CLAUDE_CORE.md §3):
// - No prisma.$transaction. Sequential awaits only.
// - Function purity: caller injects `now` so output is deterministic.
// - One bad OBD does not crash the batch — errors collected per-OBD.
//
// Implementation is split across lib/import-upsert/{types,helpers,state,
// header,lines,audit,effects}.ts. This file is the public entry point and
// hosts only the create/patch branch glue plus the upsertObd wrapper.

import { prisma } from "./prisma";
import { fmt, mergeEmailDateTime, resolveSlotFromTime, resolveSmuFromDivision } from "./import-upsert/helpers";
import { loadExistingObd, resolveCustomerId } from "./import-upsert/state";
import { applyHeaderPatch, patchHeader } from "./import-upsert/header";
import { applyLinePatch, patchLines } from "./import-upsert/lines";
import { formatAuditNote, writeAuditLogs } from "./import-upsert/audit";
import { buildEffects } from "./import-upsert/effects";
import type {
  ExistingLine,
  ExistingOrder,
  ExistingSummary,
  ImportSource,
  ObdInput,
  UpsertOptions,
  UpsertResult,
} from "./import-upsert/types";

// Re-export the public surface so callers can `import { ... } from "@/lib/import-upsert"`.
export type {
  AppliedChange,
  AppliedChangeType,
  DownstreamEffect,
  EffectType,
  ExistingLine,
  ExistingOrder,
  ExistingSummary,
  ImportSource,
  ObdInput,
  ObdLineInput,
  UpsertOptions,
  UpsertOutcome,
  UpsertResult,
} from "./import-upsert/types";
export {
  CHALLAN_ELIGIBLE_SMU,
  DIVISION_TO_SMU,
  LINE_AUTHORITY,
} from "./import-upsert/types";
export {
  mergeEmailDateTime,
  resolveSlotFromTime,
  resolveSmuFromDivision,
} from "./import-upsert/helpers";

// ─── Main entry point ─────────────────────────────────────────────────────

/**
 * Upsert a single OBD across orders, import_raw_summary, and
 * import_raw_line_items.
 *
 * Behaviour:
 * - If the OBD does not exist → create order + summary + active line items,
 *   then return outcome="created" with audit + downstream effects.
 * - If the OBD exists → compute header diff (patchHeader) and line diff
 *   (patchLines), apply them via sequential awaits, return "patched" with
 *   per-change audit + downstream effects. Returns "unchanged" if neither
 *   header nor line diff produced any work.
 * - On unique constraint race (P2002) during create → reload and patch.
 *
 * Caller responsibility: this utility does NOT fire downstream effects. The
 * caller iterates `result.effects` and dispatches them to existing functions
 * (applyMailOrderEnrichment, challan creator, etc.). This separation keeps
 * the utility unit-testable and the caller in control of effect ordering.
 *
 * Parameters:
 * - `now`      — injected for determinism (soft-remove timestamps).
 * - `userId`   — attributed in order_status_logs.changedById.
 * - `batchRef` — included in audit notes for cross-referencing import_batches.
 *
 * Errors are collected per-OBD; throwing is reserved for unrecoverable issues
 * (failed P2002 retry, unhandled DB errors not caught upstream).
 */
export async function upsertObd(
  input:    ObdInput,
  source:   ImportSource,
  batchId:  number,
  batchRef: string,
  userId:   number,
  now:      Date,
  options:  UpsertOptions = {},
): Promise<UpsertResult> {
  const dryRun = options.dryRun === true;
  const result: UpsertResult = {
    obdNumber: input.obdNumber,
    outcome:   "errored",
    orderId:   null,
    applied:   [],
    effects:   [],
    errors:    [],
    dryRun,
  };

  if (!input.obdNumber) {
    result.errors.push("obdNumber missing");
    return result;
  }

  try {
    const divisionResolved   = resolveSmuFromDivision(input.division);
    const resolvedCustomerId = options.preloaded
      ? options.preloaded.customerId
      : await resolveCustomerId(input.shipToCustomerId);
    const loaded             = options.preloaded
      ? { order: options.preloaded.order, summary: options.preloaded.summary, lines: options.preloaded.lines }
      : await loadExistingObd(input.obdNumber);

    if (loaded.order === null) {
      return await createPath(input, source, batchId, batchRef, userId, now,
        divisionResolved, resolvedCustomerId, result, dryRun);
    }

    return await patchPath(loaded.order, loaded.summary, loaded.lines,
      input, source, batchId, batchRef, userId, now,
      divisionResolved, resolvedCustomerId, result, dryRun);
  } catch (err) {
    result.outcome = "errored";
    result.errors.push(err instanceof Error ? err.message : String(err));
    return result;
  }
}

// ─── Branch: create new OBD ───────────────────────────────────────────────

async function createPath(
  input:              ObdInput,
  source:             ImportSource,
  batchId:            number,
  batchRef:           string,
  userId:             number,
  now:                Date,
  divisionResolved:   { smu: string | null; smuCode: string | null },
  resolvedCustomerId: number | null,
  result:             UpsertResult,
  dryRun:             boolean,
): Promise<UpsertResult> {
  const hasTinting    = input.lines.some((l) => l.isTinting);
  const orderType     = hasTinting ? "tint" : "non_tint";
  const workflowStage = orderType === "tint" ? "pending_tint_assignment" : "pending_support";
  const slot          = orderType === "tint" ? null : resolveSlotFromTime(input.obdEmailTime);
  const orderDate     = mergeEmailDateTime(input.obdEmailDate, input.obdEmailTime);

  let createdOrderId: number | null = null;
  if (!dryRun) {
    try {
      const created = await prisma.orders.create({
        data: {
          obdNumber:           input.obdNumber,
          batchId,
          customerId:          resolvedCustomerId,
          shipToCustomerId:    input.shipToCustomerId ?? input.obdNumber,
          shipToCustomerName:  input.shipToCustomerName,
          orderType,
          workflowStage,
          slotId:              slot?.slotId ?? null,
          originalSlotId:      slot?.slotId ?? null,
          dispatchSlot:        slot?.dispatchSlot ?? null,
          invoiceNo:           input.invoiceNo,
          soNumber:            input.soNumber,
          invoiceDate:         input.invoiceDate,
          obdEmailDate:        input.obdEmailDate,
          orderDateTime:       orderDate,
          smu:                 divisionResolved.smu,
          sapStatus:           source === "auto-import" ? input.sapStatus : null,
          materialType:        input.materialType,
          natureOfTransaction: input.natureOfTransaction,
          warehouse:           input.warehouse,
          totalUnitQty:        input.totalUnitQty,
          grossWeight:         input.grossWeight,
          volume:              input.volume,
          customerMissing:     resolvedCustomerId === null,
        },
        select: { id: true },
      });
      createdOrderId = created.id;
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        // Race: another batch created the OBD between our findUnique and create.
        // Retry as patch path.
        const retry = await loadExistingObd(input.obdNumber);
        if (retry.order) {
          return await patchPath(retry.order, retry.summary, retry.lines,
            input, source, batchId, batchRef, userId, now,
            divisionResolved, resolvedCustomerId, result, dryRun);
        }
        result.errors.push(`P2002 on create but order still not found: ${input.obdNumber}`);
        return result;
      }
      throw err;
    }

    const newSummary = await prisma.import_raw_summary.create({
      data: {
        batchId,
        obdNumber:           input.obdNumber,
        sapStatus:           input.sapStatus,
        smu:                 divisionResolved.smu,
        smuCode:             divisionResolved.smuCode,
        materialType:        input.materialType,
        natureOfTransaction: input.natureOfTransaction,
        warehouse:           input.warehouse,
        obdEmailDate:        input.obdEmailDate,
        obdEmailTime:        input.obdEmailTime,
        totalUnitQty:        input.totalUnitQty,
        grossWeight:         input.grossWeight,
        volume:              input.volume,
        billToCustomerId:    input.billToCustomerId,
        billToCustomerName:  input.billToCustomerName,
        shipToCustomerId:    input.shipToCustomerId,
        shipToCustomerName:  input.shipToCustomerName,
        invoiceNo:           input.invoiceNo,
        soNumber:            input.soNumber,
        invoiceDate:         input.invoiceDate,
        rowStatus:           "valid",
      },
      select: { id: true },
    });

    if (input.lines.length > 0) {
      await prisma.import_raw_line_items.createMany({
        data: input.lines.map((l) => ({
          rawSummaryId:      newSummary.id,
          obdNumber:         input.obdNumber,
          lineId:            l.lineId,
          skuCodeRaw:        l.skuCodeRaw,
          skuDescriptionRaw: l.skuDescriptionRaw,
          batchCode:         l.batchCode,
          unitQty:           l.unitQty,
          volumeLine:        l.volumeLine,
          isTinting:         l.isTinting,
          article:           l.article,
          articleTag:        l.articleTag,
          lineStatus:        "active",
        })),
      });
    }
  }

  result.outcome = "created";
  result.orderId = createdOrderId;  // null in dryRun mode
  result.applied.push({
    type: "obd_created",
    note: formatAuditNote("obd_created", source, batchRef,
      `OBD ${input.obdNumber} created with ${input.lines.length} line(s)`),
  });
  for (const l of input.lines) {
    result.applied.push({
      type:   "line_added",
      lineId: l.lineId,
      note:   formatAuditNote("line_added", source, batchRef,
              `lineId ${l.lineId} (sku ${l.skuCodeRaw}, qty ${l.unitQty})`),
    });
  }

  result.effects = buildEffects({
    orderId:                 createdOrderId ?? 0,
    obdNumber:               input.obdNumber,
    outcome:                 "created",
    headerEntries:           [],
    linePlan:                { adds: input.lines, patches: [], restores: [], removes: [], splitCascades: [] },
    finalSmu:                divisionResolved.smu,
    finalSoNumber:           input.soNumber,
    finalActiveLineCount:    input.lines.length,
    customerResolved:        false,
    resolvedCustomerId,
    existingOrderType:       null,
    incomingLinesHasTinting: hasTinting,
  });

  if (!dryRun && createdOrderId !== null) {
    await writeAuditLogs(createdOrderId, userId, workflowStage,
      result.applied.map((c) => ({ type: c.type, note: c.note })));
  }

  return result;
}

// ─── Branch: patch existing OBD ───────────────────────────────────────────

async function patchPath(
  existing:           ExistingOrder,
  existingSummary:    ExistingSummary | null,
  existingLines:      ExistingLine[],
  input:              ObdInput,
  source:             ImportSource,
  batchId:            number,
  batchRef:           string,
  userId:             number,
  now:                Date,
  divisionResolved:   { smu: string | null; smuCode: string | null },
  resolvedCustomerId: number | null,
  result:             UpsertResult,
  dryRun:             boolean,
): Promise<UpsertResult> {
  const headerPlan = patchHeader(existing, existingSummary, input, source, divisionResolved, resolvedCustomerId);
  const linePlan   = patchLines(existingLines, input.lines, source, batchId, now);

  const headerHadChanges = headerPlan.entries.length > 0;
  const lineHadChanges =
    linePlan.adds.length     > 0 ||
    linePlan.patches.length  > 0 ||
    linePlan.removes.length  > 0 ||
    linePlan.restores.length > 0;

  // No changes → still apply lastSeenInBatchId cascades on splits if any,
  // then mark unchanged. (Keeps split_line_items.lastSeenInBatchId fresh
  // even when nothing else changed for an OBD.)
  if (!headerHadChanges && !lineHadChanges) {
    if (!dryRun && linePlan.splitCascades.length > 0 && existingSummary) {
      await applyLinePatch(existingSummary.id, input.obdNumber, linePlan, source, batchId, now);
    }
    result.outcome = "unchanged";
    result.orderId = existing.id;
    return result;
  }

  if (!dryRun && headerHadChanges) {
    await applyHeaderPatch(existing.id, existingSummary?.id ?? null, headerPlan);
  }

  if (!dryRun && (lineHadChanges || linePlan.splitCascades.length > 0)) {
    if (!existingSummary) {
      result.errors.push(`OBD ${input.obdNumber}: no import_raw_summary; cannot apply line patches`);
    } else {
      await applyLinePatch(existingSummary.id, input.obdNumber, linePlan, source, batchId, now);
    }
  }

  for (const e of headerPlan.entries) {
    result.applied.push({
      type:     e.type,
      field:    e.field,
      oldValue: e.oldValue,
      newValue: e.newValue,
      note:     formatAuditNote(e.type, source, batchRef,
                `${e.field} ${fmt(e.oldValue)} → ${fmt(e.newValue)}`),
    });
  }
  for (const a of linePlan.adds) {
    result.applied.push({
      type:    "line_added",
      lineId:  a.lineId,
      note:    formatAuditNote("line_added", source, batchRef,
              `lineId ${a.lineId} (sku ${a.skuCodeRaw}, qty ${a.unitQty})`),
    });
  }
  for (const p of linePlan.patches) {
    const detail = p.fieldChanges.length > 0
      ? p.fieldChanges.map((c) => `${c.field} ${fmt(c.oldValue)} → ${fmt(c.newValue)}`).join(", ")
      : "lineStatus updated";
    result.applied.push({
      type:    "line_patched",
      lineId:  p.lineId,
      note:    formatAuditNote("line_patched", source, batchRef, `lineId ${p.lineId}: ${detail}`),
    });
  }
  for (const r of linePlan.restores) {
    result.applied.push({
      type:    "line_restored",
      lineId:  r.lineId,
      note:    formatAuditNote("line_restored", source, batchRef, `lineId ${r.lineId}`),
    });
  }
  for (const r of linePlan.removes) {
    result.applied.push({
      type:    "line_removed",
      lineId:  r.lineId,
      note:    formatAuditNote("line_removed", source, batchRef,
             `lineId ${r.lineId} (sku ${r.sku})`),
    });
  }

  // Compute final state for effect predicates.
  const finalSoNumber = (headerPlan.orderUpdate.soNumber as string | undefined) ?? existing.soNumber;
  const finalSmu      = (headerPlan.orderUpdate.smu      as string | undefined) ?? existing.smu;
  const removedIds    = new Set(linePlan.removes.map((r) => r.existingId));
  const finalActiveLineCount =
    existingLines.filter((l) => l.lineStatus === "active" && !removedIds.has(l.id)).length +
    linePlan.adds.length +
    linePlan.restores.length;

  result.effects = buildEffects({
    orderId:                 existing.id,
    obdNumber:               input.obdNumber,
    outcome:                 "patched",
    headerEntries:           headerPlan.entries,
    linePlan,
    finalSmu,
    finalSoNumber,
    finalActiveLineCount,
    customerResolved:        headerPlan.customerResolved,
    resolvedCustomerId,
    existingOrderType:       existing.orderType,
    incomingLinesHasTinting: input.lines.some((l) => l.isTinting),
  });

  if (!dryRun) {
    await writeAuditLogs(existing.id, userId, existing.workflowStage,
      result.applied.map((c) => ({ type: c.type, note: c.note })));
  }

  result.outcome = "patched";
  result.orderId = existing.id;
  return result;
}
