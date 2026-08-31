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
import { isMrnReceivedFrom } from "./types";
import { formatBatchNo, formatMfgDate } from "./derive";
import { buildRenderRows, reportHeaderFields, reportTotals } from "./report";

/**
 * The 19 columns, in workbook order (`PRINT` row 17, minus best before, plus
 * Description, Pack, Date of Manufacturing and Batch No). Widths are Excel
 * character units.
 *
 * Manufacturing Month and Manufacturing Year are TWO columns here and NO
 * columns at all on the A4 sheet or the desktop table, which carry only the two
 * derived strings — see lib/mrn/report.ts's header for why that divergence is
 * deliberate and not drift.
 *
 * ⚠ ALL FOUR STAY HERE, EVEN THOUGH Date of Manufacturing AND Batch No BOTH
 * REPEAT THE SAME TWO INTEGERS. This sheet mirrors the paper TPW template column
 * for column, and an .xlsx is the thing someone SORTS and FILTERS — two integers
 * do that and neither "15.08.2026" nor "T20260801" does. The A4 sheet and the
 * desktop table, which have a width budget and no filter, drop the integers.
 * Keeping all four here is the trade, not an oversight.
 *
 * ⚠ THE THREE MFG COLUMNS ARE ADJACENT AND IN THIS ORDER — Month, Year, Date,
 * then Batch No (Date of Manufacturing added 2026-08-31, immediately after
 * Manufacturing Year on owner instruction). The two hand-written positional
 * arrays below MUST be read against this list element for element; there is no
 * key on either of them, so a column inserted here and missed there silently
 * shifts every value to its right.
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
  { header: "Date of Manufacturing", width: 20 },
  { header: "Batch No", width: 12 },
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

  // Narrowed ONCE for the whole sheet. `receivedFrom` crosses the wire as a
  // plain string (lib/mrn/queries.ts:181 — it is TEXT with a CHECK Prisma cannot
  // see), and formatBatchNo() takes the UNION so that widening the CHECK breaks
  // the build. `null` is unreachable while chk_mrn_received_from stands; if it
  // ever is reached the Batch No column prints EMPTY rather than a wrong
  // prefix, which is the only safe failure on a document billing sends out.
  const receivedFrom = isMrnReceivedFrom(detail.receivedFrom) ? detail.receivedFrom : null;

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
      // 🔴 PER SUB-ROW, for the same reason as Batch No directly below — it is
      // derived from THIS sub-row's own mfg month and year, so a split line's 6a
      // and 6b carry two DIFFERENT dates. Never behind `first`.
      //
      // ⚠ A STRING, NOT A DATE. There is no day on the row (lib/mrn/derive.ts
      // supplies a fixed 15), so writing a real Date here would hand Excel a
      // precise timestamp nobody recorded and let the cell re-format itself by
      // locale. Text is the honest cell type for a date that is part filler.
      r.batch ? formatMfgDate(r.batch.mfgMonth, r.batch.mfgYear) : null,
      // 🔴 PER SUB-ROW, LIKE Physical AND Mfg — deliberately NOT behind `first`.
      // The batch number is derived FROM this sub-row’s own mfg month and year,
      // so on a split line 6a and 6b carry two DIFFERENT numbers and printing
      // only 6a’s would attribute half the tins to the wrong batch. It is not a
      // line total and cannot double-count one.
      r.batch && receivedFrom
        ? formatBatchNo(receivedFrom, r.batch.mfgMonth, r.batch.mfgYear)
        : null,
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
    // Date of Manufacturing — blank, and Batch No below it likewise. A sum of
    // dates is not a date and a sum of identifiers is not a number.
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
