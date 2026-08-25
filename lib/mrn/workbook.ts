// lib/mrn/workbook.ts
//
// The .xlsx the MRN module exists to produce — the retype into Excel, gone.
// Read by app/api/mrn/[mrnId]/export/route.ts and nothing else.
//
// 🔴 SPLIT FROM lib/mrn/report.ts ON PURPOSE, AND IT MUST STAY SPLIT.
// report.ts is imported by components/mrn/lines-table.tsx, which is a CLIENT
// component. `xlsx` is a ~900KB CommonJS bundle with side effects, so webpack
// cannot tree-shake it out of a module a client component imports — putting
// this function next to buildRenderRows() would have shipped the whole
// spreadsheet library to every billing operator’s browser, silently, with
// nothing in tsc or the build to say so. Anything importing THIS file is
// server-only. Do not merge the two back together.
//
// The column order, the row-17-not-row-16 correction and the sub-row rule all
// live in report.ts’s header. Read it before changing anything here.
//
// `xlsx` is the version already in the stack (0.18.5 — lib/sap-parser/read-sheet.ts
// and app/api/import/obd/route.ts both READ with it; this is the first place
// that writes). Design §8: do not introduce a new library for this.

import * as XLSX from "xlsx";
import type { MrnDetail } from "./types";
import { buildRenderRows, reportHeaderFields, reportTotals } from "./report";

/**
 * The 17 columns, in workbook order (`PRINT` row 17, minus best before, plus
 * Description and Pack). Widths are Excel character units.
 *
 * Manufacturing Month and Manufacturing Year are TWO columns here and one
 * merged `06/26` cell on the A4 sheet — see lib/mrn/report.ts's header for why
 * that is deliberate and not drift.
 */
const XLS_COLUMNS: { header: string; width: number }[] = [
  { header: "Sr No.", width: 7 },
  { header: "Product SKU", width: 14 },
  { header: "Description", width: 38 },
  { header: "Pack", width: 8 },
  { header: "Qty as per STI", width: 13 },
  { header: "Cartoon Qty", width: 11 },
  { header: "Qty as per Physical", width: 17 },
  { header: "Manufacturing Month", width: 19 },
  { header: "Manufacturing Year", width: 18 },
  { header: "SND", width: 7 },
  { header: "Lky", width: 7 },
  { header: "Damage", width: 8 },
  { header: "Empty", width: 8 },
  { header: "QTD", width: 7 },
  { header: "REJ", width: 7 },
  { header: "Short", width: 8 },
  { header: "Excess", width: 8 },
];

/** A cell in the sheet: a number, a string, or genuinely empty. */
type Cell = string | number | null;

/**
 * Header block, then the line table, then a TOTAL row — the order design §8
 * specifies and the order the paper already has.
 *
 * 🔴 EVERY LINE-LEVEL VALUE RIDES ON THE FIRST SUB-ROW ONLY. `carriesLineTotals`
 * comes off buildRenderRows() and gates Qty STI, Cartoon Qty and all eight
 * condition columns; only Physical and Mfg vary down a split line. Writing them
 * on 6b as well would double every one of those columns against the TOTAL row
 * sitting three inches below it, on the document billing hands to a supplier.
 * lib/mrn/report.ts's header has the reasoning; this is the call site that
 * would pay for getting it wrong.
 *
 * ⚠ BLANK IS `null`, NOT `0` AND NOT `"—"`. aoa_to_sheet() writes no cell at
 * all for a null, which is what makes an empty condition column empty rather
 * than a wall of zeroes — and a real recorded 0 (design §11 OQ-4: a truck that
 * brought none of a line) still writes as the number 0 and stays visible.
 */
export function buildMrnWorkbook(detail: MrnDetail): ArrayBuffer {
  const rows: Cell[][] = [];

  rows.push(["MATERIAL RECEIPT NOTE"]);
  rows.push(["JSW Dulux Limited · Surat Depot"]);
  rows.push([]);

  for (const f of reportHeaderFields(detail)) {
    rows.push([f.label, f.value]);
  }
  rows.push([]);

  rows.push(XLS_COLUMNS.map((c) => c.header));

  for (const r of buildRenderRows(detail.lines)) {
    const l = r.line;
    const first = r.carriesLineTotals;
    rows.push([
      r.label,
      l.skuCode,
      l.description ?? "",
      l.pack ?? "",
      first ? l.qtySti : null,
      first ? l.cartonQty : null,
      r.qtyForRow,
      r.batch ? r.batch.mfgMonth : null,
      r.batch ? r.batch.mfgYear : null,
      first ? l.sndQty : null,
      first ? l.leakyQty : null,
      first ? l.damageQty : null,
      first ? l.emptyQty : null,
      first ? l.qtdQty : null,
      first ? l.rejQty : null,
      // Derived server-side by lib/mrn/derive.ts and NEVER recomputed here
      // (design §11 OQ-2). A real 0 is not worth a cell on a condition column.
      first ? l.shortQty || null : null,
      first ? l.excessQty || null : null,
    ]);
  }

  const t = reportTotals(detail);
  rows.push([
    null,
    null,
    "TOTAL",
    null,
    t.qtySti,
    null,
    t.physical,
    null,
    null,
    t.snd || null,
    t.leaky || null,
    t.damage || null,
    t.empty || null,
    t.qtd || null,
    t.rej || null,
    t.short || null,
    t.excess || null,
  ]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = XLS_COLUMNS.map((c) => ({ wch: c.width }));
  // ⚠ NO FROZEN HEADER ROW AND NO BOLD ANYTHING. This build of `xlsx` (0.18.5,
  // the community edition already in the stack) writes neither pane splits nor
  // cell styling — `!freeze` is not a key it reads, so a `!freeze` line here
  // would look like a working feature while doing nothing at all. Either would
  // mean adding a styling fork of the library, which design §8 rules out. The
  // A4 sheet is where presentation lives; this file is the DATA.

  const wb = XLSX.utils.book_new();
  // Sheet names are capped at 31 chars and may not contain : \ / ? * [ ] — the
  // MRN number is safe on both counts, but "MRN" alone is what someone opening
  // this expects to see on the tab.
  XLSX.utils.book_append_sheet(wb, ws, "MRN");

  // `array`, not `buffer`: it hands back a plain ArrayBuffer, which IS a
  // BodyInit. A Node Buffer is not — TS rejects it outright, and working round
  // that with a cast would hide the fact that this route has no reason to touch
  // a Node-only type in the first place.
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
