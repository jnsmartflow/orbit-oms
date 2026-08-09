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
import { computeArticleInfo, loadPackCatalog, type PackCatalog } from "../article-tag";

export interface BuildObdResult {
  obds:     ObdInput[];
  skipped:  SkippedRow[];
  warnings: Warning[];
}

/**
 * Combine grouped rows + per-delivery line interims into ObdInput[]. Returns
 * a SkippedRow with reason "no-valid-lines" for any group that has no
 * surviving line after rule application.
 *
 * ASYNC as of 2026-08-09: article/articleTag now resolve against
 * sku_master_v2 (lib/article-tag.ts) instead of being hardcoded null. The
 * catalog is loaded ONCE for the whole file up front, so this stays at one
 * query per upload rather than one per line.
 */
export async function buildObds(
  groups:       GroupedDelivery[],
  applied:      AppliedRulesResult,
  fallbackObdEmailDate: Date,
): Promise<BuildObdResult> {
  const obds:    ObdInput[]   = [];
  const skipped: SkippedRow[] = [];
  const warnings: Warning[]   = [];

  // One catalog read for every SKU in the file, before the per-OBD loop.
  const allMaterials: string[] = [];
  for (const lines of Array.from(applied.linesByDelivery.values())) {
    for (const l of lines) allMaterials.push(l.skuCodeRaw);
  }
  const catalog = await loadPackCatalog(allMaterials);

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

    // Resolve article/articleTag per line against the preloaded catalog.
    // Sequential awaits, no $transaction (CLAUDE_CORE.md §3) — and with the
    // catalog already in memory these calls do no I/O at all.
    const obdLines: ObdInput["lines"][number][] = [];
    for (const l of lines) {
      obdLines.push(await lineToObdLineInput(l, catalog));
    }

    try {
      obds.push({
        obdNumber:           g.delivery,
        division:            header.division,
        sapStatus:           null,
        materialType:        null,
        natureOfTransaction: null,
        warehouse:           header.warehouse,
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
        soNumber:            header.referenceDoc,
        lines: obdLines,
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

/**
 * Map one LineInterim to an ObdLineInput, resolving article/articleTag.
 *
 * Until 2026-08-09 both fields were hardcoded null here — the ONLY rule lived
 * in the depot PC's PowerShell, so every manual-SAP line ever imported landed
 * untagged (15,370 lines across pack sizes the dictionary DID cover). The
 * rule now lives in lib/article-tag.ts and both import paths share it.
 *
 * `catalog` is preloaded by the caller, so this performs no query.
 */
async function lineToObdLineInput(
  l:       LineInterim,
  catalog: PackCatalog,
): Promise<ObdInput["lines"][number]> {
  const { article, articleTag } = await computeArticleInfo(
    { material: l.skuCodeRaw, unitQty: l.unitQty, volumeLine: l.volumeLine },
    catalog,
  );

  return {
    lineId:            l.lineId,
    skuCodeRaw:        l.skuCodeRaw,
    skuDescriptionRaw: l.skuDescriptionRaw,
    batchCode:         l.batchCode,
    unitQty:           l.unitQty,
    volumeLine:        l.volumeLine,
    netWeight:         l.netWeight,
    totalWeight:       l.totalWeight,
    isTinting:         l.isTinting,
    article,
    articleTag,
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
