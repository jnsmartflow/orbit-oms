// FUTURE: when SAP starts exporting per-row Batch numbers,
// change "group by Material" to "group by (Material, Batch)"
// so two different batches of the same SKU stay as separate
// lines instead of being summed.
//
// lib/sap-parser/apply-rules.ts
//
// Step 3 of the parse pipeline: per-delivery, apply category routing and
// the flat "drop-zero, sum-by-sku" rule, producing line-level interim
// records ready for build-obd.ts to assemble into ObdInput.lines.
//
// Rules applied here (per Step 6 simplification):
// - D.2  Whole delivery skipped when every line is ZZRE.
// - E    Mixed ZZRE lines dropped + warning.
// - 1.   Drop rows where Delivery quantity is null or 0 (silently —
//        SAP convention: qty=0 means "not yet picked" or "fully picked,
//        see picked sub-rows"; either way, we only want positive qty).
// - 2.   Group remaining rows by Material code.
// - 3.   Emit one line per Material group. lineId = lowest item number
//        in the group; description / category / isTinting taken from the
//        first row.
// - 4.   Warn `duplicate-sku-summed` when a Material group has >1 row.
// - J.3  Item ≤ 0 → drop + warning.
// - J.4  Material empty → drop + warning.
// - J.7  Unknown item category → include line, log actionable warning.
// - ZINR rows → emit `zinr-article-tag-pending` breadcrumb.
// - D.3  No surviving lines → delivery skipped with reason "no-valid-lines"
//        (handled by the caller in build-obd.ts).

import type { GroupedDelivery } from "./group-rows";
import {
  KNOWN_ITEM_CATEGORIES,
  RawSapRow,
  SkippedRow,
  Warning,
} from "./types";

export interface LineInterim {
  /** Lowest item number of the SKU group — becomes ObdLineInput.lineId. */
  lineId:            number;
  skuCodeRaw:        string;
  skuDescriptionRaw: string | null;
  unitQty:           number;
  volumeLine:        number | null;
  totalWeight:       number | null; // aggregated to OBD level later
  isTinting:         boolean;
  itemCategory:      string;        // raw, kept for OBD-level diagnostics
  parentRowNumber:   number;        // source row of the lowest-item entry
}

export interface AppliedRulesResult {
  /** Lines surviving rule application, indexed by delivery. */
  linesByDelivery: Map<string, LineInterim[]>;
  /** Deliveries skipped after rules (currently only all-ZZRE). */
  skipped:         SkippedRow[];
  warnings:        Warning[];
}

/**
 * Apply per-row and per-delivery rules to grouped data. Returns interim
 * line shapes plus collected warnings/skipped.
 */
export function applyRules(groups: GroupedDelivery[]): AppliedRulesResult {
  const linesByDelivery = new Map<string, LineInterim[]>();
  const skipped:  SkippedRow[] = [];
  const warnings: Warning[]    = [];

  for (const g of groups) {
    // Skip rule D.2 — entire delivery is ZZRE.
    const allZzre = g.rows.every((r) => r.itemCategory === "ZZRE");
    if (allZzre) {
      skipped.push({
        delivery:   g.delivery,
        reason:     "all-lines-ZZRE",
        rowNumbers: g.rows.map((r) => r.rowNumber),
      });
      continue;
    }

    // STEP 1 — Filter rows: drop ZZRE (warn), drop qty=0/null (silent),
    // drop non-positive item (warn), drop missing material (warn).
    // Per-row category warnings (unknown-item-category, ZINR breadcrumb)
    // are emitted here too so they reach the result regardless of grouping.
    const usableRows: RawSapRow[] = [];
    for (const r of g.rows) {
      if (r.itemCategory === "ZZRE") {
        warnings.push({
          delivery:   g.delivery,
          kind:       "mixed-zzre-line",
          message:    `ZZRE line item ${r.item} on row ${r.rowNumber} dropped (mixed with non-ZZRE lines in delivery ${g.delivery})`,
          rowNumbers: [r.rowNumber],
        });
        continue;
      }

      if (r.deliveryQuantity === null || r.deliveryQuantity === 0) {
        // Silent drop — SAP convention: qty=0 means the row carries no
        // pickable quantity (either not yet picked or already fully picked
        // via a counterpart row). We're only interested in qty>0.
        continue;
      }

      if (r.item <= 0) {
        warnings.push({
          delivery:   g.delivery,
          kind:       "negative-or-zero-item",
          message:    `row ${r.rowNumber} has non-positive item number (${r.item}); dropping`,
          rowNumbers: [r.rowNumber],
        });
        continue;
      }

      if (!r.material) {
        warnings.push({
          delivery:   g.delivery,
          kind:       "missing-material",
          message:    `row ${r.rowNumber} (item ${r.item}) has no Material; dropping`,
          rowNumbers: [r.rowNumber],
        });
        continue;
      }

      // Category warnings — emitted per usable row regardless of grouping.
      const category = r.itemCategory ?? "";
      const isKnown  = (KNOWN_ITEM_CATEGORIES as readonly string[]).includes(category);
      if (!isKnown) {
        warnings.push({
          delivery:   g.delivery,
          kind:       "unknown-item-category",
          message:    `unknown item category '${category}' on row ${r.rowNumber} (delivery ${g.delivery}) — defaulting to isTinting=false`,
          rowNumbers: [r.rowNumber],
        });
      }
      if (category === "ZINR") {
        warnings.push({
          delivery:   g.delivery,
          kind:       "zinr-article-tag-pending",
          message:    `ZINR row needs articleTag rule (deferred)`,
          rowNumbers: [r.rowNumber],
        });
      }

      usableRows.push(r);
    }

    // STEP 2 — Group by Material code, preserving first-seen order.
    const groupedBySku = new Map<string, RawSapRow[]>();
    for (const r of usableRows) {
      const sku = r.material as string; // checked non-null above
      if (!groupedBySku.has(sku)) groupedBySku.set(sku, []);
      groupedBySku.get(sku)!.push(r);
    }

    // STEP 3 — Emit one line per Material group.
    const lines: LineInterim[] = [];
    for (const [sku, skuRows] of Array.from(groupedBySku.entries())) {
      // lineId = lowest item number in this group.
      const lowestItemRow = skuRows.reduce(
        (acc: RawSapRow, r: RawSapRow) => (r.item < acc.item ? r : acc),
        skuRows[0],
      );
      const firstRow = skuRows[0];

      let qtySum = 0;
      let volSum: number | null = null;
      let wtSum:  number | null = null;
      for (const r of skuRows) {
        qtySum += r.deliveryQuantity ?? 0;
        if (r.volume      !== null) volSum = (volSum ?? 0) + r.volume;
        if (r.totalWeight !== null) wtSum  = (wtSum  ?? 0) + r.totalWeight;
      }

      // Warn if multiple rows summed — flags the future-batch-tracking case.
      if (skuRows.length > 1) {
        warnings.push({
          delivery:   g.delivery,
          kind:       "duplicate-sku-summed",
          message:    `SKU ${sku} appeared in ${skuRows.length} rows in delivery ${g.delivery}; summed unitQty ${qtySum}, volumeLine ${volSum}. Future: if Batch column appears in SAP exports, switch to one-line-per-(SKU, Batch).`,
          rowNumbers: skuRows.map((r: RawSapRow) => r.rowNumber),
        });
      }

      lines.push({
        lineId:            lowestItemRow.item,
        skuCodeRaw:        sku,
        skuDescriptionRaw: firstRow.description,
        unitQty:           qtySum,
        volumeLine:        volSum,
        totalWeight:       wtSum,
        isTinting:         (firstRow.itemCategory ?? "") === "Z007",
        itemCategory:      firstRow.itemCategory ?? "",
        parentRowNumber:   lowestItemRow.rowNumber,
      });
    }

    if (lines.length > 0) {
      linesByDelivery.set(g.delivery, lines);
    }
  }

  return { linesByDelivery, skipped, warnings };
}
