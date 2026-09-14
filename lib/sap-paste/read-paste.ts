// lib/sap-paste/read-paste.ts
//
// Step 1 of the PASTE pipeline — the clipboard counterpart of
// lib/sap-parser/read-sheet.ts. Turns the text an operator copies out of SAP's
// on-screen OBD list into the same RawSapRow[] that readSheet() produces, so
// groupRows / applyRules / buildObds run on it UNCHANGED.
//
// PURE and SYNCHRONOUS. No Prisma, no I/O, no clock. NEVER THROWS — every
// problem comes back as a per-line error (or one `fatal`), and ANY error means
// the whole paste is blocked. Errors accumulate so the operator sees every bad
// line at once. Same contract as lib/mrn/paste.ts.
//
// 🔴 WHY BLOCK AND NEVER SKIP. On an OBD that already exists, manual-sap is the
// AUTHORITATIVE source: a line absent from the incoming set is soft-removed
// (lib/import-upsert/lines.ts:151-164). A row silently skipped here would
// delete a real line on the floor.
//
// The shape it accepts (verified against docs/fixtures/12.09.2026.txt):
//   ------------------------------------------------------------   ruler
//   |  Delivery  |ShPt  |SLoc|Dv|Sold-To Pt|… |Batch     |          header, ONCE
//   ------------------------------------------------------------   ruler
//   |  9109179959|IN53  |2000|70|3537829   |… |C20260701 |          data
//   ------------------------------------------------------------   ruler
// 19 columns in the .xlsx order (CLAUDE_IMPORT.md §3.1). "." decimal, ","
// thousands.

import type { RawSapRow } from "../sap-parser/types";
import { toStrOrNull } from "../sap-parser/cells";

/**
 * Column widths of the two customer-name columns in SAP's screen list. A name
 * at this width may have been cut off by the screen — the full name is
 * resolved separately (by customer code, outside this pure module).
 */
export const PASTE_NAME_WIDTHS = { soldTo: 22, shipTo: 25 } as const;

export interface PasteRowError {
  /** 1-based line number in the pasted text. */
  sourceLine: number;
  /** The raw text of the offending line. */
  raw: string;
  message: string;
}

export interface ReadPasteResult {
  rows: RawSapRow[];
  errors: PasteRowError[];
  /** Data rows under the header (excludes rulers and the header). */
  totalRows: number;
  /** 1-based line of the header row, or null when none was found. */
  headerLine: number | null;
  /** Picked sub-rows whose "001"-style Item was converted to 900001-style. */
  convertedSubItems: number;
  /** A problem with the paste as a whole. Non-null means nothing is usable. */
  fatal: string | null;
}

/** 0-based cell positions — the same 19 columns as read-sheet.ts's COL map. */
const CELL = {
  delivery:        0,
  warehouse:       1,
  storageLocation: 2, // read, never used downstream — same as read-sheet.ts
  division:        3,
  soldToParty:     4,
  soldToName:      5,
  shipToParty:     6,
  shipToName:      7,
  referenceDoc:    8,
  deliveryType:    9,
  itemCategory:   10,
  item:           11,
  material:       12,
  description:    13,
  deliveryQty:    14,
  volume:         15,
  netWeight:      16,
  totalWeight:    17,
  batch:          18,
} as const;

const COLUMN_COUNT = 19;

/**
 * SAP numbers picked batch sub-rows from 900001. The screen list drops the
 * "900" and zero-pads the rest to three digits ("001", "028"). Main items
 * (10, 20 … 630) never carry a leading zero.
 */
const SUB_ITEM_BASE = 900000;

/**
 * A delivery whose picked rows have reached this number is close enough to 100
 * that a later un-padded "100", "110" … could be either a main item or a picked
 * row. Every such token in that delivery is refused rather than guessed.
 * Observed since 2026-05-14: highest picked row 900061, zero OBDs at ≥900100.
 */
const HIGH_SUB_THRESHOLD = 90;

const RULER_RE = /^[\s|\-+=]+$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

/**
 * Strip ONE leading and ONE trailing "|", split on "|", trim each cell.
 * Only whitespace is trimmed from the line first, so a missing edge pipe
 * cannot eat a real cell.
 */
function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function looksLikeHeader(cells: string[]): boolean {
  return (
    cells.length === COLUMN_COUNT &&
    cells[CELL.delivery].toLowerCase().startsWith("deliv") &&
    cells[CELL.item].toLowerCase() === "item" &&
    cells[CELL.material].toLowerCase().startsWith("mater")
  );
}

function sameCells(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Parse a numeric cell. Thousands separators are removed first. Blank is
 * null (matches cells.ts toNum). Anything else that is not a plain decimal is
 * "invalid" — never a guess.
 */
function parsePasteNumber(cell: string): number | null | "invalid" {
  if (cell === "") return null;
  const cleaned = cell.replace(/,/g, "");
  if (!NUMBER_RE.test(cleaned)) return "invalid";
  return Number(cleaned);
}

function ambiguousMessage(delivery: string, token: string): string {
  return (
    `Delivery ${delivery}, item "${token}": this delivery has too many picked rows for SAP's ` +
    `screen list to number them safely - "${token}" could be main item ${token} or picked ` +
    `row 900${token}. Nothing was imported. Import this day from the .xlsx instead.`
  );
}

/** A data line that passed PASS 1, with the Item cell still RAW TEXT. */
interface StagedRow {
  sourceLine: number;
  raw: string;
  cells: string[];
  /** Sheet-equivalent row number: header is row 1, first data row is row 2. */
  rowNumber: number;
}

/**
 * Read a pasted SAP screen list into RawSapRow[].
 *
 * Never throws. Check `fatal` first, then `errors` — the paste is usable only
 * when both are empty.
 */
export function readPaste(block: string): ReadPasteResult {
  const lines = block.split(/\r\n|\r|\n/);
  const errors: PasteRowError[] = [];
  const staged: StagedRow[] = [];

  let header: string[] | null = null;
  let headerLine: number | null = null;
  // Counts every data line under the header — including an all-blank one,
  // which read-sheet.ts also lets occupy a sheet row — so rowNumber keeps
  // group-rows.ts' contiguity check behaving exactly as it does for the .xlsx.
  let dataOrdinal = 0;

  // ── PASS 1 — classify every line ──────────────────────────────────────────
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const sourceLine = index + 1;
    const trimmed = raw.trim();

    if (trimmed === "") continue;
    if (RULER_RE.test(trimmed) && trimmed.includes("-")) continue;

    const cells = splitCells(raw);

    if (header === null) {
      if (looksLikeHeader(cells)) {
        header = cells;
        headerLine = sourceLine;
      }
      // Anything above the header that is not a header is ignored.
      continue;
    }

    if (sameCells(cells, header)) continue; // page-break repeat

    if (cells.length !== COLUMN_COUNT) {
      errors.push({
        sourceLine,
        raw,
        message: `Line ${sourceLine}: expected ${COLUMN_COUNT} columns, found ${cells.length}`,
      });
      continue;
    }

    const rowNumber = dataOrdinal + 2;
    dataOrdinal += 1;

    // Every cell blank → skip silently, matching read-sheet.ts:137.
    if (cells.every((c) => c === "")) continue;

    if (cells[CELL.delivery] === "") {
      errors.push({
        sourceLine,
        raw,
        message: `Line ${sourceLine}: this row has no delivery number.`,
      });
      continue;
    }

    staged.push({ sourceLine, raw, cells, rowNumber });
  }

  if (header === null) {
    return {
      rows: [], errors: [], totalRows: 0, headerLine: null, convertedSubItems: 0,
      fatal: "This does not look like the SAP OBD list - no header row was found.",
    };
  }
  if (dataOrdinal === 0) {
    return {
      rows: [], errors, totalRows: 0, headerLine, convertedSubItems: 0,
      fatal: "No delivery rows found under the header.",
    };
  }

  // ── PASS 2 — which deliveries have picked rows near the 100 boundary ──────
  const highSub = new Set<string>();
  for (const s of staged) {
    const token = s.cells[CELL.item];
    if (/^0\d{2}$/.test(token) && Number.parseInt(token, 10) >= HIGH_SUB_THRESHOLD) {
      highSub.add(s.cells[CELL.delivery]);
    }
  }

  // ── PASS 3 — convert the Item on the RAW TEXT, read numbers, build rows ───
  const rows: RawSapRow[] = [];
  let convertedSubItems = 0;

  for (const s of staged) {
    const c = s.cells;
    const delivery = c[CELL.delivery];
    const token = c[CELL.item];
    let rowOk = true;

    // 🔴 THE ITEM IS DECIDED ON THE TEXT, NEVER ON A PARSED INTEGER.
    // parseInt("010") is 10, which is also real main item 10 — the leading
    // zero is the only thing that tells a picked row from a main item, and it
    // must be read before anything turns the token into a number. It must also
    // happen before applyRules, whose BATCH_SUB_ITEM_FLOOR (900000) drives the
    // parent-item double-count fix.
    let item = 0;
    if (/^0\d{2}$/.test(token) && Number.parseInt(token, 10) > 0) {
      item = SUB_ITEM_BASE + Number.parseInt(token, 10);
      convertedSubItems += 1;
    } else if (token.startsWith("0")) {
      errors.push({
        sourceLine: s.sourceLine,
        raw: s.raw,
        message: `Item "${token}": leading zero but not 3 digits - SAP's format has changed.`,
      });
      rowOk = false;
    } else if (/^[1-9]\d*$/.test(token)) {
      const value = Number.parseInt(token, 10);
      if (value % 10 !== 0 || (value >= 100 && highSub.has(delivery))) {
        errors.push({ sourceLine: s.sourceLine, raw: s.raw, message: ambiguousMessage(delivery, token) });
        rowOk = false;
      } else {
        item = value;
      }
    } else {
      errors.push({
        sourceLine: s.sourceLine,
        raw: s.raw,
        message: `Item "${token}" is not a number.`,
      });
      rowOk = false;
    }

    const numbers: Array<[keyof typeof CELL, string]> = [
      ["deliveryQty", "Delivery qty"],
      ["volume",      "Volume"],
      ["netWeight",   "Net weight"],
      ["totalWeight", "Total Wght"],
    ];
    const parsed: Record<string, number | null> = {};
    for (const [key, label] of numbers) {
      const v = parsePasteNumber(c[CELL[key]]);
      if (v === "invalid") {
        errors.push({
          sourceLine: s.sourceLine,
          raw: s.raw,
          message: `Line ${s.sourceLine}: "${c[CELL[key]]}" in ${label} is not a number.`,
        });
        rowOk = false;
      } else {
        parsed[key] = v;
      }
    }

    if (!rowOk) continue;

    rows.push({
      rowNumber:        s.rowNumber,
      delivery,
      warehouse:        toStrOrNull(c[CELL.warehouse]),
      division:         toStrOrNull(c[CELL.division]),
      soldToParty:      toStrOrNull(c[CELL.soldToParty]),
      soldToName:       toStrOrNull(c[CELL.soldToName]),
      shipToParty:      toStrOrNull(c[CELL.shipToParty]),
      shipToName:       toStrOrNull(c[CELL.shipToName]),
      referenceDoc:     toStrOrNull(c[CELL.referenceDoc]),
      deliveryType:     toStrOrNull(c[CELL.deliveryType]),
      itemCategory:     toStrOrNull(c[CELL.itemCategory]),
      item,
      material:         toStrOrNull(c[CELL.material]),
      description:      toStrOrNull(c[CELL.description]),
      deliveryQuantity: parsed.deliveryQty,
      volume:           parsed.volume,
      netWeight:        parsed.netWeight,
      totalWeight:      parsed.totalWeight,
      batch:            toStrOrNull(c[CELL.batch]),
    });
  }

  return {
    rows,
    errors,
    totalRows: dataOrdinal,
    headerLine,
    convertedSubItems,
    fatal: null,
  };
}
