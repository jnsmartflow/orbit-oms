// lib/stock-audit/workbook.ts
//
// The .xlsx behind the stock audit desk's Export: one row per SKU — SKU,
// Description, Pack, Total pcs, Lines. Read by
// app/api/stock-audit/audits/[id]/export/route.ts and nothing else.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 SERVER-ONLY, AND THAT IS STRUCTURAL — NOT A STYLE PREFERENCE.
// ═══════════════════════════════════════════════════════════════════════════
// `xlsx` is a ~900KB CommonJS bundle with side effects, so webpack cannot
// tree-shake it out of any module a CLIENT component imports. lib/stock-audit/
// types.ts, status.ts and calc.ts are imported by the phone screen, so this
// builder may never move into any of them and none of them may ever import
// this file. Copied from lib/ci/workbook.ts, which carries the same warning.
//
// lib/stock-audit/queries.ts imports `StockAuditRegisterRow` from here with
// `import type`, which TypeScript erases entirely (isolatedModules). A plain
// `import` would pull the spreadsheet library into every stock-audit route.
//
// ⚠ `xlsx` 0.18.5 — the version already in the stack (lib/ci/workbook.ts,
// lib/mrn/workbook.ts). Do not introduce a second library.
//
// (SKUs here are the SAP `material` as stored on the line — never a catalog
// row id; CORE §13, the id-space landmine.)

import * as XLSX from "xlsx";

/** One SKU as the export needs it — produced by getRegisterRows (queries.ts).
 *  Not in types.ts: it never crosses the wire as JSON. */
export interface StockAuditRegisterRow {
  material: string;
  description: string | null;
  pack: string | null;
  /** Sum of the live lines' qty (always pieces) — the "Total pcs" column. */
  qty: number;
  lines: number;
}

const COLUMNS: { header: string; width: number }[] = [
  { header: "SKU", width: 14 },
  { header: "Description", width: 48 },
  { header: "Pack", width: 10 },
  { header: "Total pcs", width: 12 },
  { header: "Lines", width: 8 },
];

const SHEET_NAME = "Stock count";

type Cell = string | number | null;

/**
 * Build the workbook. An EMPTY audit is a header-only workbook, not an error
 * (the CI rule): "nothing counted yet" is an answer, and the file shape stays
 * the same either way.
 */
export function buildStockAuditWorkbook(rows: readonly StockAuditRegisterRow[]): ArrayBuffer {
  const sheet: Cell[][] = [COLUMNS.map((c) => c.header)];
  for (const r of rows) {
    // material is a JS string, so aoa_to_sheet writes a TEXT cell — a
    // digits-only code keeps its leading zero (01033071). Never Number() it.
    sheet.push([r.material, r.description, r.pack, r.qty, r.lines]);
  }
  const ws = XLSX.utils.aoa_to_sheet(sheet);
  ws["!cols"] = COLUMNS.map((c) => ({ wch: c.width }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);
  // `array`, not `buffer`: a plain ArrayBuffer IS a BodyInit; a Node Buffer is not.
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
