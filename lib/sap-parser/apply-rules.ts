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
// - P.   Parent item superseded by its batch sub-items → drop + VISIBLE skip
//        reason. Runs after rule 1 so the ordinary zeroed parent still takes
//        the cheap path and keeps its silent drop. Only sub-items that
//        themselves survive rules 0/E/1/J.3/J.4 supersede anything.
//
// Rules 0, E, 1, J.3 and J.4 have ONE implementation — `classifyRow` — because
// rule P's pre-pass has to ask the same question the filter loop asks.
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

/**
 * SAP numbers batch sub-items from 900000 up; the parent delivery item it was
 * split from keeps its own low number (10, 20, 30 …). A row at or above this
 * floor is therefore a batch sub-item, and its parent carries no stock of its
 * own. Deliveries that were never batch-split keep all their stock on the low
 * numbers — see rule P below, which is careful never to touch those.
 */
const BATCH_SUB_ITEM_FLOOR = 900000;

/**
 * The verdict of the per-row filters. `keep` carries the Material so callers
 * get it non-null without a cast; each rejection names the rule that fired so
 * the caller can raise the right warning or skip.
 */
type RowVerdict =
  | { keep: true;  material: string }
  | { keep: false; reason: "non-LF" | "zzre" | "qty-zero" | "non-positive-item" | "no-material" };

/**
 * THE single definition of "would this row survive the per-row filters",
 * evaluated in the order the rules are applied.
 *
 * Called twice per row — once by rule P's pre-pass, once by the filter loop —
 * and the two MUST agree. As first shipped (25fc3c99) the pre-pass used its
 * own inline test, so a sub-item row the loop would itself discard (qty 0,
 * ZZRE, non-LF) still qualified its SKU for rule P: the parent was dropped as
 * superseded while the sub-item that was supposed to carry the stock had
 * already been thrown away, and the units vanished silently. One function,
 * one answer, nothing to drift.
 */
function classifyRow(r: RawSapRow): RowVerdict {
  if ((r.deliveryType ?? "").toUpperCase() !== "LF")           return { keep: false, reason: "non-LF" };
  if (r.itemCategory === "ZZRE")                               return { keep: false, reason: "zzre" };
  if (r.deliveryQuantity === null || r.deliveryQuantity === 0) return { keep: false, reason: "qty-zero" };
  if (r.item <= 0)                                             return { keep: false, reason: "non-positive-item" };
  if (!r.material)                                             return { keep: false, reason: "no-material" };
  return { keep: true, material: r.material };
}

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

    // PRE-PASS for rule P — collect the SKUs in this delivery that have a
    // batch sub-item row THAT ITSELF SURVIVES the per-row filters. Built in
    // full BEFORE the filter loop below so nothing is mutated while iterating,
    // and so a parent is judged against every sub-item in the delivery
    // regardless of row order.
    //
    // The survivability test is `classifyRow`, the same function the loop
    // below uses — a sub-item that is about to be discarded cannot carry the
    // parent's stock, so it must not be allowed to supersede the parent.
    const skusWithBatchSubItems = new Set<string>();
    for (const r of g.rows) {
      if (r.item < BATCH_SUB_ITEM_FLOOR) continue;
      const verdict = classifyRow(r);
      if (verdict.keep) skusWithBatchSubItems.add(verdict.material);
    }

    // STEP 1 — Filter rows: drop non-LF (skip + record), drop ZZRE (warn),
    // drop qty=0/null (silent), drop non-positive item (warn), drop missing
    // material (warn), drop superseded parents (skip + record, rule P). Per-row
    // category warnings (unknown-item-category, ZINR breadcrumb) emitted here too.
    const usableRows: RawSapRow[] = [];
    for (const r of g.rows) {
      // Rules 0/E/1/J.3/J.4, in that order, from the shared classifier. The
      // switch only decides how each rejection is REPORTED — the conditions
      // themselves live in classifyRow and nowhere else.
      const verdict = classifyRow(r);
      if (!verdict.keep) {
        switch (verdict.reason) {
          case "non-LF":
            // Row-level LF filter — broaden the existing delivery-level skip
            // (group-rows.ts D.1) to catch non-LF rows embedded in otherwise-LF
            // deliveries (rare but real). Whole-delivery non-LF returns are
            // already caught upstream by D.1; this only fires for mixed cases.
            skipped.push({
              delivery:   g.delivery,
              reason:     "non-LF row",
              rowNumbers: [r.rowNumber],
            });
            break;
          case "zzre":
            warnings.push({
              delivery:   g.delivery,
              kind:       "mixed-zzre-line",
              message:    `ZZRE line item ${r.item} on row ${r.rowNumber} dropped (mixed with non-ZZRE lines in delivery ${g.delivery})`,
              rowNumbers: [r.rowNumber],
            });
            break;
          case "qty-zero":
            // Silent drop — SAP convention: qty=0 means the row carries no
            // pickable quantity (either not yet picked or already fully picked
            // via a counterpart row). We're only interested in qty>0.
            break;
          case "non-positive-item":
            warnings.push({
              delivery:   g.delivery,
              kind:       "negative-or-zero-item",
              message:    `row ${r.rowNumber} has non-positive item number (${r.item}); dropping`,
              rowNumbers: [r.rowNumber],
            });
            break;
          case "no-material":
            warnings.push({
              delivery:   g.delivery,
              kind:       "missing-material",
              message:    `row ${r.rowNumber} (item ${r.item}) has no Material; dropping`,
              rowNumbers: [r.rowNumber],
            });
            break;
        }
        continue;
      }

      // Rule P — parent item superseded by its batch sub-items. When SAP
      // batch-splits a delivery item it moves the stock onto sub-items
      // numbered from BATCH_SUB_ITEM_FLOOR up and normally zeroes the parent,
      // so rule 1 above drops it silently. On 2026-09-07 12:54 it did not:
      // OBD 9109269668 arrived with parent item 10 still carrying the 26 units
      // that sub-item 900028 also carried, and the pipeline stored the stock
      // twice (54+26+26 against a true 80).
      //
      // Scope is deliberately narrow. A low-numbered row is dropped ONLY when
      // the SAME delivery carries a sub-item row for the SAME SKU — a delivery
      // that was never batch-split keeps every unit on items 10/20/30 and is
      // untouched. `skuCodeRaw` is compared exactly as read: Material codes are
      // case-sensitive SAP identifiers, so no trim beyond the cell coercer and
      // no case folding.
      //
      // Unlike the qty=0 drop this one is NOT silent. It is rare — 3 events in
      // 4 months — and silence is precisely how it went unnoticed, so it lands
      // in `skipped[]` where the preview and the batch record both show it.
      //
      // `skusWithBatchSubItems` holds only sub-items that survive the filters
      // above (see the pre-pass), so a parent is never dropped in favour of a
      // sub-item that was itself discarded.
      if (r.item < BATCH_SUB_ITEM_FLOOR && skusWithBatchSubItems.has(verdict.material)) {
        skipped.push({
          delivery:   g.delivery,
          reason:     "parent item superseded by batch sub-items",
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
