// scripts/generate-final-review-xlsx.ts
//
// Generates a nicely-formatted FINAL_REVIEW workbook for offline triage.
// Reuses scripts/lib/sampling-classifier.ts for the in-memory classification
// run, then renders three sheets via exceljs:
//   - Data    : every source row + Action/Remarks, with date numFmt + colour rule
//   - Summary : one row per unique sampling no
//   - Stats   : metric/value block (totals, top reasons, pack source breakdown)
//
// Run: npx tsx scripts/generate-final-review-xlsx.ts

import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import * as path from "path";
import * as fs from "fs";
import {
  SOURCE_PATH,
  STOCK_PATH,
  SKU_MASTER_PATH,
  runClassification,
  type Action,
} from "./lib/sampling-classifier";

const OUTPUT_PATH = "docs/plans/sampling-register/Tinting_data_Tracker_N_FINAL_REVIEW.xlsx";

// ── Style constants ─────────────────────────────────────────────────────────

const HEADER_FILL    = "FF1F2937"; // gray-900
const HEADER_FG      = "FFFFFFFF";
const BORDER_COLOR   = "FFE5E7EB"; // gray-200
const DATA_FONT_SIZE = 10;
const DATE_NUMFMT    = "dd-mmm-yyyy";

const ACTION_STYLES: Record<Action, { bg: string; text: string }> = {
  IMPORT: { bg: "FFD1FAE5", text: "FF065F46" },
  REVIEW: { bg: "FFFEF3C7", text: "FF92400E" },
  SKIP:   { bg: "FFFEE2E2", text: "FF991B1B" },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function isDateHeader(header: string): boolean {
  return /date/i.test(header);
}

function isPigmentHeader(header: string): boolean {
  return /^[A-Z]{3}$/.test(header.trim().toUpperCase());
}

function colWidth(header: string): number {
  const h = header.trim().toLowerCase();
  if (h === "action")   return 12;
  if (h === "remarks")  return 50;
  if (/sampling/.test(h))                 return 12;
  if (/date/.test(h))                     return 14;
  if (/shade.*name|shade.*code/.test(h))  return 36;
  if (/^desc/.test(h) || /description/.test(h)) return 36;
  if (/sku/.test(h))                      return 16;
  if (isPigmentHeader(header))            return 8;
  return 14;
}

// Excel epoch is 1899-12-30 (the 1900 leap-year bug means serial 60 maps
// to a non-existent 1900-02-29; this offset bakes that in).
function excelSerialToDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
}

function tryParseExcelDate(v: unknown): Date | null {
  if (typeof v !== "number") return null;
  if (!Number.isFinite(v)) return null;
  if (v < 20000 || v > 80000) return null; // plausible-date-serial gate
  return excelSerialToDate(v);
}

function applyHeaderStyle(row: ExcelJS.Row): void {
  row.height = 28;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.font = { bold: true, color: { argb: HEADER_FG }, size: 10 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top:    { style: "thin", color: { argb: BORDER_COLOR } },
      bottom: { style: "thin", color: { argb: BORDER_COLOR } },
      left:   { style: "thin", color: { argb: BORDER_COLOR } },
      right:  { style: "thin", color: { argb: BORDER_COLOR } },
    };
  });
}

function applyActionFill(cell: ExcelJS.Cell, action: Action): void {
  const cfg = ACTION_STYLES[action];
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cfg.bg } };
  cell.font = { bold: true, color: { argb: cfg.text }, size: DATA_FONT_SIZE };
  cell.alignment = { horizontal: "center", vertical: "middle" };
}

function applyRowBorder(row: ExcelJS.Row): void {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.border = {
      top:    { style: "thin", color: { argb: BORDER_COLOR } },
      bottom: { style: "thin", color: { argb: BORDER_COLOR } },
      left:   { style: "thin", color: { argb: BORDER_COLOR } },
      right:  { style: "thin", color: { argb: BORDER_COLOR } },
    };
  });
}

function isNonIntegerSamplingRaw(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "number") return Number.isFinite(v) && Math.floor(v) !== v;
  const s = String(v).trim();
  return /^\d+\.\d+$/.test(s);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // ── Pre-flight ────────────────────────────────────────────────────────────
  for (const p of [SOURCE_PATH, STOCK_PATH, SKU_MASTER_PATH]) {
    if (!fs.existsSync(p)) {
      console.error(`Required input not found: ${p}`);
      process.exit(1);
    }
  }

  console.log("Reading source workbook + running classifier in-memory...");
  const wb = XLSX.readFile(SOURCE_PATH, { cellDates: false });
  const result = runClassification(wb);

  const { canonHeaders, includedSheets, sheetRowsByName, groups, decisions, invalidRows, allRows, stockLoad, legacyLoad } = result;
  const headers = [...canonHeaders, "Action", "Remarks"];
  const actionColIdx0  = headers.length - 2;       // 0-based
  const actionColIdx1  = actionColIdx0 + 1;        // 1-based for exceljs

  const dateColIdxs0 = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => isDateHeader(h))
    .map(({ i }) => i);

  // ── Build output workbook ─────────────────────────────────────────────────
  const out = new ExcelJS.Workbook();
  out.creator = "OrbitOMS sampling pipeline";
  out.created = new Date();

  // === Sheet: Data ==========================================================
  const dataSheet = out.addWorksheet("Data");

  for (let i = 0; i < headers.length; i++) {
    dataSheet.getColumn(i + 1).width = colWidth(headers[i]);
  }

  const headerRow = dataSheet.addRow(headers);
  applyHeaderStyle(headerRow);

  let dataRowsWritten = 0;
  const counts: Record<Action, { groups: number; rows: number }> = {
    IMPORT: { groups: 0, rows: 0 },
    REVIEW: { groups: 0, rows: 0 },
    SKIP:   { groups: 0, rows: 0 },
  };
  for (const m of includedSheets) {
    const rowsForSheet = sheetRowsByName.get(m.name) ?? [];
    for (const row of rowsForSheet) {
      let action: Action;
      let remarks: string;
      if (row.samplingNo == null) {
        action = "SKIP";
        remarks = isNonIntegerSamplingRaw(row.samplingRaw)
          ? "non-integer sampling no"
          : "invalid sampling no";
      } else {
        const d = decisions.get(row.samplingNo)!;
        action = d.action;
        remarks = d.remarks;
      }
      counts[action].rows += 1;

      // Build row values; convert date-column cells to JS Date when plausible.
      const values: unknown[] = row.originalCells.map((c, idx) => {
        if (dateColIdxs0.includes(idx)) {
          const d = tryParseExcelDate(c);
          if (d !== null) return d;
        }
        return c ?? null;
      });
      values.push(action, remarks);

      const xlrow = dataSheet.addRow(values);
      xlrow.height = 18;

      // Cell-level styling: font size, numFmt on dates, action fill, borders.
      xlrow.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { size: DATA_FONT_SIZE };
        cell.border = {
          top:    { style: "thin", color: { argb: BORDER_COLOR } },
          bottom: { style: "thin", color: { argb: BORDER_COLOR } },
          left:   { style: "thin", color: { argb: BORDER_COLOR } },
          right:  { style: "thin", color: { argb: BORDER_COLOR } },
        };
      });
      for (const idx0 of dateColIdxs0) {
        const cell = xlrow.getCell(idx0 + 1);
        if (cell.value instanceof Date) {
          cell.numFmt = DATE_NUMFMT;
          cell.alignment = { horizontal: "center", vertical: "middle" };
        }
      }
      applyActionFill(xlrow.getCell(actionColIdx1), action);
      // Remarks: muted color, wrap text
      const remarksCell = xlrow.getCell(actionColIdx1 + 1);
      remarksCell.font = { size: DATA_FONT_SIZE, color: { argb: "FF4B5563" } };
      remarksCell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };

      dataRowsWritten += 1;
    }
  }

  dataSheet.views = [{ state: "frozen", ySplit: 1 }];
  dataSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to:   { row: dataRowsWritten + 1, column: headers.length },
  };

  // Aggregate group counts (used later by Stats sheet). Invalid-sampling rows
  // have no sampling number so they don't form a group — matches the prior
  // classifier's "SKIP: 2 sampling nos (825 rows)" reporting style.
  for (const [no, d] of Array.from(decisions.entries())) {
    void no;
    counts[d.action].groups += 1;
  }

  // === Sheet: Summary =======================================================
  const summarySheet = out.addWorksheet("Summary");
  const summaryHeaders = ["samplingNo", "rowCount", "action", "remarks", "shadeNames", "skuCodes"];
  const summaryWidths  = [12, 10, 12, 50, 40, 40];
  for (let i = 0; i < summaryWidths.length; i++) {
    summarySheet.getColumn(i + 1).width = summaryWidths[i];
  }
  applyHeaderStyle(summarySheet.addRow(summaryHeaders));

  const orderedKeys = Array.from(groups.keys()).sort((a, b) => a - b);
  let summaryRowsWritten = 0;
  for (const no of orderedKeys) {
    const rows = groups.get(no)!;
    const d = decisions.get(no)!;
    const r = summarySheet.addRow([
      no,
      rows.length,
      d.action,
      d.remarks,
      d.shadeNames.join(", "),
      d.skuCodes.join(", "),
    ]);
    r.height = 18;
    r.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { size: DATA_FONT_SIZE };
      cell.border = {
        top:    { style: "thin", color: { argb: BORDER_COLOR } },
        bottom: { style: "thin", color: { argb: BORDER_COLOR } },
        left:   { style: "thin", color: { argb: BORDER_COLOR } },
        right:  { style: "thin", color: { argb: BORDER_COLOR } },
      };
    });
    applyActionFill(r.getCell(3), d.action);
    r.getCell(4).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    summaryRowsWritten += 1;
  }
  if (invalidRows.length > 0) {
    const r = summarySheet.addRow([
      "(invalid)",
      invalidRows.length,
      "SKIP",
      "rows without a valid sampling no",
      "",
      "",
    ]);
    r.height = 18;
    applyRowBorder(r);
    r.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { size: DATA_FONT_SIZE };
    });
    applyActionFill(r.getCell(3), "SKIP");
    summaryRowsWritten += 1;
  }

  summarySheet.views = [{ state: "frozen", ySplit: 1 }];
  summarySheet.autoFilter = {
    from: { row: 1, column: 1 },
    to:   { row: summaryRowsWritten + 1, column: summaryHeaders.length },
  };

  // === Sheet: Stats =========================================================
  const statsSheet = out.addWorksheet("Stats");
  statsSheet.getColumn(1).width = 36;
  statsSheet.getColumn(2).width = 14;
  applyHeaderStyle(statsSheet.addRow(["Metric", "Value"]));

  // Pack-source breakdown
  let fromDesc = 0, fromStock = 0, fromLegacy = 0, unresolved = 0;
  for (const r of allRows) {
    if (r.packSource === "desc")        fromDesc   += 1;
    else if (r.packSource === "stock")  fromStock  += 1;
    else if (r.packSource === "legacy") fromLegacy += 1;
    else                                unresolved += 1;
  }

  // Top reasons
  const reviewReasons = new Map<string, number>();
  const skipReasons   = new Map<string, number>();
  for (const [no, d] of Array.from(decisions.entries())) {
    void no;
    if (d.action === "REVIEW") {
      const first = d.remarks.split(" | ")[0] || "other";
      const bucket = first.startsWith("multi-shade")                                ? "multi-shade"
        : first.startsWith("partial blank")                                         ? "partial blank shadeName"
        : first.startsWith("unknown pack")                                          ? "unknown pack"
        : first.startsWith("no DESC, SKU not in stock or legacy master")            ? "no DESC, SKU not in stock or legacy master"
        : first.startsWith("no DESC, SKU in master but pack unrecognized")          ? "no DESC, SKU in master but pack unrecognized"
        : first;
      reviewReasons.set(bucket, (reviewReasons.get(bucket) ?? 0) + 1);
    } else if (d.action === "SKIP") {
      skipReasons.set(d.remarks, (skipReasons.get(d.remarks) ?? 0) + 1);
    }
  }
  if (invalidRows.length > 0) {
    const key = "invalid/non-integer sampling no";
    skipReasons.set(key, (skipReasons.get(key) ?? 0) + invalidRows.length);
  }
  const topReview = Array.from(reviewReasons.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topSkip   = Array.from(skipReasons.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const statsRows: Array<[string, string | number]> = [
    ["Source file",                       SOURCE_PATH],
    ["Stock master unique SKUs",          stockLoad.map.size],
    ["Stock master collisions",           stockLoad.collisions],
    ["Legacy master unique SKUs",         legacyLoad.map.size],
    ["Legacy master collisions",          legacyLoad.collisions.length],
    ["",                                  ""],
    ["Total rows read",                   allRows.length],
    ["Total unique sampling numbers",     groups.size],
    ["",                                  ""],
    ["IMPORT — sampling nos",             counts.IMPORT.groups],
    ["IMPORT — rows",                     counts.IMPORT.rows],
    ["REVIEW — sampling nos",             counts.REVIEW.groups],
    ["REVIEW — rows",                     counts.REVIEW.rows],
    ["SKIP — sampling nos",               counts.SKIP.groups],
    ["SKIP — rows",                       counts.SKIP.rows],
    ["",                                  ""],
    ["Pack source: DESC column",          fromDesc],
    ["Pack source: stock master",         fromStock],
    ["Pack source: legacy master",        fromLegacy],
    ["Pack source: unresolved (REVIEW)",  unresolved],
    ["",                                  ""],
    ["Top 5 REVIEW reasons",              ""],
    ...topReview.map(([reason, n], i): [string, number] => [`  ${i + 1}. ${reason}`, n]),
    ["",                                  ""],
    ["Top 5 SKIP reasons",                ""],
    ...topSkip.map(([reason, n], i): [string, number] => [`  ${i + 1}. ${reason}`, n]),
  ];

  for (const [metric, value] of statsRows) {
    const r = statsSheet.addRow([metric, value]);
    r.height = 18;
    r.getCell(1).font = { size: DATA_FONT_SIZE, bold: metric !== "" && !metric.startsWith("  ") };
    r.getCell(2).font = { size: DATA_FONT_SIZE };
    if (metric !== "") {
      applyRowBorder(r);
    }
  }
  statsSheet.views = [{ state: "frozen", ySplit: 1 }];

  // ── Save ──────────────────────────────────────────────────────────────────
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  await out.xlsx.writeFile(OUTPUT_PATH);

  // ── Verification: re-open + inspect first 20 data rows of each date column ─
  const verify = new ExcelJS.Workbook();
  await verify.xlsx.readFile(OUTPUT_PATH);
  const verifyData = verify.getWorksheet("Data");
  if (!verifyData) {
    console.error("Verification failed: Data sheet missing from output");
    process.exit(1);
  }
  const formattedCols: string[] = [];
  for (const idx0 of dateColIdxs0) {
    const headerText = headers[idx0] || `col${idx0 + 1}`;
    let formattedHits = 0;
    let sampled = 0;
    const maxRow = Math.min(21, verifyData.rowCount);
    for (let rowNum = 2; rowNum <= maxRow; rowNum++) {
      const cell = verifyData.getRow(rowNum).getCell(idx0 + 1);
      if (cell.value instanceof Date) {
        sampled += 1;
        if (cell.numFmt) formattedHits += 1;
      }
    }
    if (sampled > 0 && formattedHits === sampled) {
      formattedCols.push(headerText.trim());
    } else if (sampled > 0) {
      formattedCols.push(`${headerText.trim()} (partial ${formattedHits}/${sampled})`);
    }
  }

  // ── Print summary ─────────────────────────────────────────────────────────
  const sizeKB = Math.round(fs.statSync(OUTPUT_PATH).size / 1024);
  console.log("");
  console.log("===== FINAL_REVIEW Excel ready =====");
  console.log(`Path: ${OUTPUT_PATH}`);
  console.log(`Size: ${sizeKB} KB`);
  console.log(`Sheets: Data (${dataRowsWritten} rows), Summary (${summaryRowsWritten} rows), Stats`);
  console.log(`Date columns formatted: ${formattedCols.length > 0 ? formattedCols.join(", ") : "(none)"}`);
  console.log(`IMPORT / REVIEW / SKIP counts: ${counts.IMPORT.groups} / ${counts.REVIEW.groups} / ${counts.SKIP.groups}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
