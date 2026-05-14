// lib/sap-parser/apply-rules.ts
//
// Step 3 of the parse pipeline: per-delivery, apply pre-filters and emit
// one LineInterim per surviving row (no SKU grouping — duplicate-SKU rows
// persist as separate lines so per-batch tracking flows through).
//
// Rules applied here:
// - D.2  Whole delivery skipped when every line is ZZRE.
// - E    Mixed ZZRE lines dropped + warning.
// - 0.   Drop rows where Delivery Type ≠ "LF" (returns embedded in non-
//        return deliveries). Recorded in `skipped[]` with reason "non-LF row".
// - 1.   Drop rows where Delivery quantity is null or 0 (silently —
//        SAP convention: qty=0 means "not yet picked" or "fully picked,
//        see picked sub-rows"; either way, we only want positive qty).
// - 2.   Emit one LineInterim per surviving row. No grouping by Material;
//        rows that share an SKU (different batches, different items, etc.)
//        remain as separate lines.
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
  /** SAP item number from col 12 — becomes ObdLineInput.lineId. */
  lineId:            number;
  skuCodeRaw:        string;
  skuDescriptionRaw: string | null;
  batchCode:         string | null;
  unitQty:           number;
  volumeLine:        number | null;
  netWeight:         number | null;
  totalWeight:       number | null; // also aggregated to OBD-level grossWeight
  isTinting:         boolean;
  itemCategory:      string;        // raw, kept for OBD-level diagnostics
  parentRowNumber:   number;        // source row number (1:1 with RawSapRow post-rewrite)
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

    // STEP 1 — Filter rows: drop non-LF (skip + record), drop ZZRE (warn),
    // drop qty=0/null (silent), drop non-positive item (warn), drop missing
    // material (warn). Per-row category warnings (unknown-item-category,
    // ZINR breadcrumb) emitted here too.
    const usableRows: RawSapRow[] = [];
    for (const r of g.rows) {
      // Row-level LF filter — broaden the existing delivery-level skip
      // (group-rows.ts D.1) to catch non-LF rows embedded in otherwise-LF
      // deliveries (rare but real). Whole-delivery non-LF returns are
      // already caught upstream by D.1; this only fires for mixed cases.
      if ((r.deliveryType ?? "").toUpperCase() !== "LF") {
        skipped.push({
          delivery:   g.delivery,
          reason:     "non-LF row",
          rowNumbers: [r.rowNumber],
        });
        continue;
      }

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

    // STEP 2 — 1:1 mapping. Every surviving row becomes one LineInterim.
    // No grouping by SKU; rows that share a Material (different batches,
    // different items, or two source-system entries for the same SKU) all
    // persist as separate DB rows. Matches Auto-Import precedent.
    const lines: LineInterim[] = [];
    for (const r of usableRows) {
      lines.push({
        lineId:            r.item,
        skuCodeRaw:        r.material as string, // checked non-null above
        skuDescriptionRaw: r.description,
        batchCode:         r.batch,
        unitQty:           r.deliveryQuantity ?? 0,
        volumeLine:        r.volume,
        netWeight:         r.netWeight,
        totalWeight:       r.totalWeight,
        isTinting:         (r.itemCategory ?? "") === "Z007",
        itemCategory:      r.itemCategory ?? "",
        parentRowNumber:   r.rowNumber,
      });
    }

    if (lines.length > 0) {
      linesByDelivery.set(g.delivery, lines);
    }
  }

  return { linesByDelivery, skipped, warnings };
}
