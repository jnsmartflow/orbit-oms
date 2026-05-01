// lib/import-upsert/lines.ts
//
// Line-level patch: pure planner (patchLines) + DB executor (applyLinePatch).
// Cascades line-status changes from import_raw_line_items down to
// split_line_items so dispatch/picking views see the soft-removes.

import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import {
  ExistingLine,
  ImportSource,
  LINE_AUTHORITY,
  LinePatchEntry,
  LinePatchPlan,
  ObdLineInput,
} from "./types";

/**
 * Compute the line-level diff between an existing OBD's lines and the
 * incoming set. Pure: no DB access.
 *
 * Behaviour gated by LINE_AUTHORITY[source]:
 * - Authoritative (manual-sap): can overwrite qty/volume/sku/isTinting on
 *   existing lines, restore previously soft-removed lines, and soft-remove
 *   active lines absent from the incoming set (when incoming is non-empty).
 * - Non-authoritative (auto-import, manual-template): adds new lines,
 *   fills NULL volumeLine on existing lines. Never overwrites, never removes.
 * - All sources update lastSeenInBatchId on split_line_items for every
 *   incoming line that matches an existing raw line.
 *
 * Empty-incoming-list rule (option (a) confirmed by user): authoritative
 * sources that arrive with zero lines do NOT soft-remove existing lines —
 * they must send at least one line to claim authority over the line set.
 */
export function patchLines(
  existingLines: ExistingLine[],
  incomingLines: ObdLineInput[],
  source:        ImportSource,
  batchId:       number,
  now:           Date,
): LinePatchPlan {
  const auth = LINE_AUTHORITY[source];

  // Match by SKU code (skuCodeRaw, trimmed). lineId is unreliable as a
  // matching key across import sources — auto-import wrote 0 historically
  // while SAP brings real SAP item numbers (10, 20, 900001…). Material
  // codes are case-sensitive identifiers in SAP, so exact match (no
  // .toLowerCase()), trimmed defensively for stray whitespace.
  //
  // Same-SKU duplicates inside either set are unexpected — the parser
  // sums by SKU per delivery, and existing rows should be one-per-SKU.
  // When duplicates do appear (e.g. legacy data from a prior bad import),
  // prefer the first occurrence and log a warning so it's diagnosable.
  const bySkuCode = new Map<string, ExistingLine>();
  for (const l of existingLines) {
    const key = l.skuCodeRaw.trim();
    if (bySkuCode.has(key)) {
      console.warn(`[patchLines] Duplicate SKU '${key}' in existing lines for batch ${batchId}; using first (id=${bySkuCode.get(key)!.id}, ignored=${l.id})`);
      continue;
    }
    bySkuCode.set(key, l);
  }
  const incomingBySkuCode = new Map<string, ObdLineInput>();
  for (const l of incomingLines) {
    const key = l.skuCodeRaw.trim();
    if (incomingBySkuCode.has(key)) {
      console.warn(`[patchLines] Duplicate SKU '${key}' in incoming lines for batch ${batchId}; using first occurrence`);
      continue;
    }
    incomingBySkuCode.set(key, l);
  }

  const plan: LinePatchPlan = {
    adds: [], patches: [], restores: [], removes: [], splitCascades: [],
  };

  for (const inc of Array.from(incomingBySkuCode.values())) {
    const existing = bySkuCode.get(inc.skuCodeRaw.trim());
    if (!existing) {
      plan.adds.push(inc);
      continue;
    }

    plan.splitCascades.push({ rawLineItemId: existing.id, lastSeenInBatchId: batchId });

    const updates: Prisma.import_raw_line_itemsUpdateInput = {};
    const fieldChanges: LinePatchEntry["fieldChanges"] = [];

    if (auth) {
      if (existing.unitQty !== inc.unitQty) {
        updates.unitQty = inc.unitQty;
        fieldChanges.push({ field: "unitQty", oldValue: existing.unitQty, newValue: inc.unitQty });
      }
      if ((existing.volumeLine ?? null) !== (inc.volumeLine ?? null)) {
        updates.volumeLine = inc.volumeLine;
        fieldChanges.push({ field: "volumeLine", oldValue: existing.volumeLine, newValue: inc.volumeLine });
      }
      // skuCodeRaw never changes here — matched by SKU, equal by construction.
      if (existing.isTinting !== inc.isTinting) {
        updates.isTinting = inc.isTinting;
        fieldChanges.push({ field: "isTinting", oldValue: existing.isTinting, newValue: inc.isTinting });
      }

      if (existing.lineStatus !== "active") {
        updates.lineStatus    = "active";
        updates.removedAt     = null;
        updates.removedReason = null;
        plan.restores.push({ existingId: existing.id, lineId: existing.lineId });
        plan.splitCascades.push({
          rawLineItemId: existing.id,
          lineStatus:    "active",
          removedAt:     null,
          removedReason: null,
        });
      }
    } else if (existing.volumeLine === null && inc.volumeLine !== null) {
      updates.volumeLine = inc.volumeLine;
      fieldChanges.push({ field: "volumeLine", oldValue: null, newValue: inc.volumeLine });
    }

    if (Object.keys(updates).length > 0) {
      plan.patches.push({
        existingId: existing.id,
        lineId:     existing.lineId,
        updates,
        fieldChanges,
      });
    }
  }

  // Soft-removes — authoritative source only, AND incoming list non-empty.
  if (auth && incomingLines.length > 0) {
    for (const ex of existingLines) {
      if (ex.lineStatus !== "active") continue;
      if (incomingBySkuCode.has(ex.skuCodeRaw.trim())) continue;
      plan.removes.push({ existingId: ex.id, lineId: ex.lineId, sku: ex.skuCodeRaw });
      plan.splitCascades.push({
        rawLineItemId: ex.id,
        lineStatus:    "removed_by_import",
        removedAt:     now,
        removedReason: `Removed by ${source} batch ${batchId}`,
      });
    }
  }

  return plan;
}

/**
 * Run the line-level writes produced by patchLines:
 * 1. createMany for new lines (`adds`).
 * 2. Per-line updates for `patches` (sequential — one per line).
 * 3. updateMany for soft-removes.
 * 4. updateMany cascades on split_line_items for each rawLineItemId touched
 *    (lineStatus mirror + lastSeenInBatchId).
 * Sequential awaits throughout (CLAUDE_CORE.md §3).
 */
export async function applyLinePatch(
  rawSummaryId: number,
  obdNumber:    string,
  plan:         LinePatchPlan,
  source:       ImportSource,
  batchId:      number,
  now:          Date,
): Promise<void> {
  if (plan.adds.length > 0) {
    await prisma.import_raw_line_items.createMany({
      data: plan.adds.map((inc) => ({
        rawSummaryId,
        obdNumber,
        lineId:            inc.lineId,
        skuCodeRaw:        inc.skuCodeRaw,
        skuDescriptionRaw: inc.skuDescriptionRaw,
        batchCode:         inc.batchCode,
        unitQty:           inc.unitQty,
        volumeLine:        inc.volumeLine,
        isTinting:         inc.isTinting,
        article:           inc.article,
        articleTag:        inc.articleTag,
        lineStatus:        "active",
      })),
    });
  }

  for (const p of plan.patches) {
    await prisma.import_raw_line_items.update({
      where: { id: p.existingId },
      data:  p.updates,
    });
  }

  if (plan.removes.length > 0) {
    await prisma.import_raw_line_items.updateMany({
      where: { id: { in: plan.removes.map((r) => r.existingId) } },
      data:  {
        lineStatus:    "removed_by_import",
        removedAt:     now,
        removedReason: `Removed by ${source} batch ${batchId}`,
      },
    });
  }

  for (const cascade of plan.splitCascades) {
    const data: Record<string, unknown> = {};
    if (cascade.lineStatus        !== undefined) data.lineStatus        = cascade.lineStatus;
    if (cascade.removedAt         !== undefined) data.removedAt         = cascade.removedAt;
    if (cascade.removedReason     !== undefined) data.removedReason     = cascade.removedReason;
    if (cascade.lastSeenInBatchId !== undefined) data.lastSeenInBatchId = cascade.lastSeenInBatchId;
    if (Object.keys(data).length === 0) continue;
    await prisma.split_line_items.updateMany({
      where: { rawLineItemId: cascade.rawLineItemId },
      data,
    });
  }
}
