// lib/sap-parser/read-sheet.ts
//
// Step 1 of the parse pipeline: open the XLSX workbook, validate the header
// row, and convert each data row into a RawSapRow via position-based column
// lookup (1-indexed in the design spec → 0-indexed array internally).
//
// Position-based lookup is the stable contract — SAP exports occasionally
// drift on header text but never on column order. We do verify the header
// row has at least 25 cells before parsing, but we do not match by name.

import * as XLSX from "xlsx";
import {
  FileFormatError,
  FileParseError,
  RawSapRow,
  Warning,
} from "./types";
import { toInt, toNum, toStr, toStrOrNull } from "./cells";

/** 1-based column positions of fields the parser depends on (from design §C). */
const COL = {
  delivery:        1,
  item:            2,
  division:        5,
  soldToParty:     6,
  soldToName:      7,
  refItem:         9,
  material:       10,
  description:    11,
  deliveryQty:    12,
  volume:         14,
  totalWeight:    15,
  shipToParty:    16,
  shipToName:     17,
  itemCategory:   24,
  deliveryType:   25,
} as const;

/**
 * Columns the parser cannot function without. If any of these are blank
 * across the entire header row, throw FileFormatError. We do not validate
 * header *text*, only that the slot exists (i.e. row 1 has at least 25 cells).
 */
const REQUIRED_COLS = [
  COL.delivery, COL.item, COL.division,
  COL.material, COL.deliveryQty,
  COL.itemCategory, COL.deliveryType,
];

interface ReadSheetResult {
  rows:       RawSapRow[];
  /** Total data rows (excludes header). */
  totalRows:  number;
  /** Warnings raised during row parsing — e.g. row-parse-failed. */
  warnings:   Warning[];
}

/**
 * Open the workbook, locate the target sheet, validate the header, and
 * return the data rows as RawSapRow[] alongside any per-row warnings.
 *
 * Throws:
 * - FileParseError: workbook cannot be opened by SheetJS.
 * - FileFormatError: target sheet missing OR header row has fewer than
 *   the required column count.
 */
export function readSheet(
  buffer:    ArrayBuffer | Buffer,
  sheetName?: string,
): ReadSheetResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer as Buffer, { type: "buffer", cellDates: false });
  } catch (err) {
    throw new FileParseError(
      `XLSX read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const targetSheetName = sheetName ?? wb.SheetNames[0];
  if (!targetSheetName) {
    throw new FileFormatError("Workbook contains no sheets");
  }

  const sheet = wb.Sheets[targetSheetName];
  if (!sheet) {
    throw new FileFormatError(`Sheet "${targetSheetName}" not found in workbook`);
  }

  // Use header:1 to receive arrays-of-arrays (positional access) rather than
  // objects keyed by header text. Defval:null so missing cells parse cleanly.
  const rawArr = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw:    true,
    defval: null,
  });

  if (rawArr.length === 0) {
    return { rows: [], totalRows: 0, warnings: [] };
  }

  const headerRow = rawArr[0];
  const headerWidth = Array.isArray(headerRow) ? headerRow.length : 0;
  const missingColumns: number[] = [];
  for (const c of REQUIRED_COLS) {
    if (headerWidth < c || headerRow[c - 1] === null || headerRow[c - 1] === undefined || toStr(headerRow[c - 1]) === "") {
      missingColumns.push(c);
    }
  }
  if (missingColumns.length > 0) {
    throw new FileFormatError(
      `Header row is missing required column position(s): ${missingColumns.join(", ")}`,
      missingColumns,
    );
  }

  const rows: RawSapRow[] = [];
  const warnings: Warning[] = [];
  // Row 1 is the header; data rows start at sheet row 2.
  for (let i = 1; i < rawArr.length; i++) {
    const r = rawArr[i];
    const rowNumber = i + 1;
    if (!Array.isArray(r)) continue;

    try {
      const delivery = toStr(r[COL.delivery - 1]);
      // Skip blank lines silently — SheetJS sometimes emits trailing empties.
      if (!delivery) continue;

      rows.push({
        rowNumber,
        delivery,
        item:             toInt(r[COL.item - 1]) ?? 0,
        division:         toStrOrNull(r[COL.division - 1]),
        soldToParty:      toStrOrNull(r[COL.soldToParty - 1]),
        soldToName:       toStrOrNull(r[COL.soldToName - 1]),
        refItem:          toInt(r[COL.refItem - 1]),
        material:         toStrOrNull(r[COL.material - 1]),
        description:      toStrOrNull(r[COL.description - 1]),
        deliveryQuantity: toNum(r[COL.deliveryQty - 1]),
        volume:           toNum(r[COL.volume - 1]),
        totalWeight:      toNum(r[COL.totalWeight - 1]),
        shipToParty:      toStrOrNull(r[COL.shipToParty - 1]),
        shipToName:       toStrOrNull(r[COL.shipToName - 1]),
        itemCategory:     toStrOrNull(r[COL.itemCategory - 1]),
        deliveryType:     toStrOrNull(r[COL.deliveryType - 1]),
      });
    } catch (err) {
      warnings.push({
        kind:       "row-parse-failed",
        message:    `row ${rowNumber} could not be parsed: ${err instanceof Error ? err.message : String(err)}`,
        rowNumbers: [rowNumber],
      });
    }
  }

  return { rows, totalRows: rawArr.length - 1, warnings };
}
