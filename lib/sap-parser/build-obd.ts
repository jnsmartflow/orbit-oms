// lib/sap-parser/build-obd.ts
//
// Step 4 of the parse pipeline: combine the per-delivery line interims with
// the original grouped rows (for header values) into ObdInput shapes.
//
// Header values come from the FIRST row of each delivery (rows are in
// source-file order). All non-skipped deliveries with at least one
// surviving line produce one ObdInput. Deliveries with zero surviving
// lines after rule application are reported as `no-valid-lines` skipped.

import type { ObdInput } from "../import-upsert/types";
import type { GroupedDelivery } from "./group-rows";
import type { AppliedRulesResult, LineInterim } from "./apply-rules";
import type { SkippedRow, Warning } from "./types";

export interface BuildObdResult {
  obds:     ObdInput[];
  skipped:  SkippedRow[];
  warnings: Warning[];
}

/**
 * Combine grouped rows + per-delivery line interims into ObdInput[]. Returns
 * a SkippedRow with reason "no-valid-lines" for any group that has no
 * surviving line after rule application.
 */
export function buildObds(
  groups:       GroupedDelivery[],
  applied:      AppliedRulesResult,
  fallbackObdEmailDate: Date,
): BuildObdResult {
  const obds:    ObdInput[]   = [];
  const skipped: SkippedRow[] = [];
  const warnings: Warning[]   = [];

  for (const g of groups) {
    const lines = applied.linesByDelivery.get(g.delivery);
    if (!lines || lines.length === 0) {
      skipped.push({
        delivery:   g.delivery,
        reason:     "no-valid-lines",
        rowNumbers: g.rows.map((r) => r.rowNumber),
      });
      continue;
    }

    const header = g.rows[0];

    // Sum numeric line fields up to the OBD level. "sum or null" semantics:
    // null only if every line's value is null; otherwise sum the non-null
    // values (treating null as not-applicable rather than zero).
    const totalUnitQty = lines.reduce((acc, l) => acc + l.unitQty, 0);
    const volume       = sumOrNull(lines.map((l) => l.volumeLine));
    const grossWeight  = sumOrNull(lines.map((l) => l.totalWeight));

    try {
      obds.push({
        obdNumber:           g.delivery,
        division:            header.division,
        sapStatus:           null,
        materialType:        null,
        natureOfTransaction: null,
        warehouse:           null,
        obdEmailDate:        fallbackObdEmailDate,
        obdEmailTime:        null,
        totalUnitQty,
        grossWeight,
        volume,
        billToCustomerId:    header.soldToParty,
        billToCustomerName:  header.soldToName,
        shipToCustomerId:    header.shipToParty,
        shipToCustomerName:  header.shipToName,
        invoiceNo:           null,
        invoiceDate:         null,
        soNumber:            null,
        lines: lines.map(linesToObdLineInput),
      });
    } catch (err) {
      warnings.push({
        delivery:   g.delivery,
        kind:       "row-parse-failed",
        message:    `delivery ${g.delivery} could not be assembled: ${err instanceof Error ? err.message : String(err)}`,
        rowNumbers: g.rows.map((r) => r.rowNumber),
      });
    }
  }

  return { obds, skipped, warnings };
}

function linesToObdLineInput(l: LineInterim): ObdInput["lines"][number] {
  return {
    lineId:            l.lineId,
    skuCodeRaw:        l.skuCodeRaw,
    skuDescriptionRaw: l.skuDescriptionRaw,
    batchCode:         null,
    unitQty:           l.unitQty,
    volumeLine:        l.volumeLine,
    isTinting:         l.isTinting,
    article:           null,
    articleTag:        null,
  };
}

/**
 * Sum a list of `number | null` values. Returns null only when every entry
 * is null; otherwise sums the numeric entries (null treated as not-applicable).
 */
function sumOrNull(values: Array<number | null>): number | null {
  let acc: number | null = null;
  for (const v of values) {
    if (v === null) continue;
    acc = (acc ?? 0) + v;
  }
  return acc;
}
