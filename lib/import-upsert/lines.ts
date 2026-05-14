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
 * Composite key for matching incoming SAP rows to existing DB rows.
 * SKU alone is not unique — same SKU can appear on multiple lineIds
 * within one OBD (e.g. line 10 and line 20 both carry IN70270181, or
 * line 900001 and 900002 both carry the same tinter SKU with different
 * batches). lineId disambiguates these.
 *
 * skuCodeRaw is trimmed defensively (stray whitespace from XLS cells).
 * Material codes are case-sensitive identifiers in SAP — no .toLowerCase().
 */
function makeKey(lineId: number, skuCodeRaw: string): string {
  return `${lineId}|${skuCodeRaw.trim()}`;
}

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

  // Match by composite key (lineId + skuCodeRaw, trimmed). SKU alone is
  // not unique within an OBD — duplicate SKUs occur on separate lineIds
  // (e.g. same tinter SKU on lineIds 10 and 20, or on the 900001/900002
  // breakwall series with different batches).
  //
  // lineId is stored as Int in DB, so leading-zero padding from SAP
  // (e.g. "000070") is stripped at parse time — "70" and "000070"
  // converge on 70 and match correctly across import sources.
  //
  // Material codes are case-sensitive identifiers in SAP, so exact
  // match (no .toLowerCase()), trimmed defensively for stray whitespace.
  const byKey = new Map<string, ExistingLine>();
  for (const l of existingLines) {
    const key = makeKey(l.lineId, l.skuCodeRaw);
    if (byKey.has(key)) {
      const prior = byKey.get(key)!;
      console.warn(
        `[patchLines] Duplicate (lineId=${l.lineId}, sku='${l.skuCodeRaw.trim()}') in existing lines for batch ${batchId}; using first (id=${prior.id}, ignored=${l.id})`,
      );
      continue;
    }
    byKey.set(key, l);
  }
  const incomingByKey = new Map<string, ObdLineInput>();
  for (const l of incomingLines) {
    const key = makeKey(l.lineId, l.skuCodeRaw);
    if (incomingByKey.has(key)) {
      console.warn(
        `[patchLines] Duplicate (lineId=${l.lineId}, sku='${l.skuCodeRaw.trim()}') in incoming lines for batch ${batchId}; using first occurrence`,
      );
      continue;
    }
    incomingByKey.set(key, l);
  }

  const plan: LinePatchPlan = {
    adds: [], patches: [], restores: [], removes: [], splitCascades: [],
  };

  for (const inc of Array.from(incomingByKey.values())) {
    const existing = byKey.get(makeKey(inc.lineId, inc.skuCodeRaw));
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
      if (incomingByKey.has(makeKey(ex.lineId, ex.skuCodeRaw))) continue;
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
        netWeight:         inc.netWeight   ?? null,
        totalWeight:       inc.totalWeight ?? null,
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
