// lib/sap-parser/types.ts
//
// Public types for the SAP OBT XLSX parser. Imported by the rest of the
// lib/sap-parser/* files and re-exported from index.ts.

import type { ObdInput } from "../import-upsert/types";

// ─── Public types ─────────────────────────────────────────────────────────

export interface ParseOptions {
  /**
   * The date the operator picked at upload. Stamped on every parsed OBD's
   * `obdEmailDate` field — the SAP file itself has no email-date column.
   */
  fallbackObdEmailDate: Date;
  /**
   * Optional sheet-name override. Defaults to the first sheet in the
   * workbook (matches typical SAP exports which only contain "Sheet1").
   */
  sheetName?: string;
}

export interface ParseResult {
  obds:     ObdInput[];
  skipped:  SkippedRow[];
  warnings: Warning[];
  fileStats: {
    /** Count of data rows in the sheet (excludes the header row). */
    totalRows:         number;
    /** Count of distinct Delivery values seen — includes skipped ones. */
    uniqueDeliveries:  number;
    /** Length of `obds[]`. */
    createdObds:       number;
    /** Length of `skipped[]`. */
    skippedDeliveries: number;
  };
}

export interface SkippedRow {
  delivery:   string;
  reason:     "non-LF return" | "all-lines-ZZRE" | "no-valid-lines";
  rowNumbers: number[];
}

export type WarningKind =
  | "negative-or-zero-item"
  | "missing-material"
  | "non-numeric-qty"
  | "unknown-item-category"
  | "mixed-zzre-line"
  | "duplicate-delivery-header"
  | "duplicate-sku-summed"
  | "row-parse-failed"
  | "zinr-article-tag-pending"
  | "stats-mismatch";

export interface Warning {
  /** Optional — some warnings (stats-mismatch) are file-level. */
  delivery?:  string;
  kind:       WarningKind;
  message:    string;
  rowNumbers: number[];
}

// ─── Internal types — exported for cross-file use within lib/sap-parser ───

/**
 * One parsed XLSX row reduced to the load-bearing columns. Built by
 * read-sheet.ts; consumed by group-rows.ts and apply-rules.ts.
 */
export interface RawSapRow {
  /** 1-indexed row number in the source file (header is row 1, data starts at 2). */
  rowNumber:           number;
  delivery:            string;
  item:                number;        // parsed integer; 0 if unparseable
  division:            string | null; // raw code
  soldToParty:         string | null;
  soldToName:          string | null;
  refItem:             number | null; // links sub-row to parent's `item`
  material:            string | null;
  description:         string | null;
  deliveryQuantity:    number | null;
  volume:              number | null;
  totalWeight:         number | null;
  shipToParty:         string | null;
  shipToName:          string | null;
  itemCategory:        string | null;
  deliveryType:        string | null;
}

/**
 * Item categories the parser recognises. Anything outside this set is
 * still emitted as a line but logged as `unknown-item-category`.
 */
export const KNOWN_ITEM_CATEGORIES = ["TAN", "Z007", "ZKL3", "ZINR", "ZZRE"] as const;
export type KnownItemCategory = typeof KNOWN_ITEM_CATEGORIES[number];

// ─── Errors (named classes, instanceof-checkable by callers) ──────────────

export class FileParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileParseError";
  }
}

export class FileFormatError extends Error {
  constructor(message: string, public readonly missingColumns: number[] = []) {
    super(message);
    this.name = "FileFormatError";
  }
}
