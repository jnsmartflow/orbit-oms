// lib/mrn/paste.ts
//
// Parses the block the billing operator pastes out of the STI sheet into
// `{ lineNo, skuCode, qtySti }` rows.
//
// PURE. No Prisma, no I/O, no clock. Catalog resolution is a separate step
// (lib/mrn/resolve-lines.ts) so the preview can show WHAT WAS PARSED even when
// every code is unmastered.
//
// The shape it must accept is the source workbook's PASTE sheet: three columns,
// Sr no · SKU · Qty as per STI. Two columns (SKU · Qty) also work, because the
// Sr no is optional.
//
// ⚠ NOTHING HERE THROWS. Every problem comes back as a per-row error so the
// preview modal can render "34 matched, 2 could not be read" beside the rows
// that did parse. A paste of 36 lines with one typo must not lose the other 35.

/** One successfully parsed line. */
export interface MrnPasteRow {
  /**
   * The line's final number — what lands in `mrn_lines.lineNo`, which is
   * UNIQUE per MRN. See `numbering` on MrnPasteResult for where it came from.
   */
  lineNo: number;
  /** Trimmed, upper-cased SAP material code. */
  skuCode: string;
  qtySti: number;
  /** 1-based position in the pasted block, for "row 7 could not be read". */
  sourceRow: number;
}

export interface MrnPasteError {
  sourceRow: number;
  /** The raw text of the offending line, so the operator can spot it. */
  raw: string;
  message: string;
}

export interface MrnPasteResult {
  rows: MrnPasteRow[];
  errors: MrnPasteError[];
  /** True when a header row was detected and skipped. */
  headerSkipped: boolean;
  /** Which separator won. Surfaced so the preview can explain a bad parse. */
  delimiter: "tab" | "comma";
  /**
   * `pasted`     — every row carried a usable, distinct Sr no, so those numbers
   *                were kept (a paste of rows 5-10 stays 5-10, matching the
   *                operator's own sheet).
   * `sequential` — Sr numbers were absent, unusable or duplicated, so rows were
   *                numbered 1..N in paste order.
   *
   * The fallback is not cosmetic: `mrn_lines` has UNIQUE(mrnId, lineNo), so
   * honouring duplicated Sr numbers would throw a P2002 on save.
   */
  numbering: "pasted" | "sequential";
}

/** A row as it looked before numbering was decided. */
interface StagedRow {
  sourceRow: number;
  srNo: number | null;
  skuCode: string;
  qtySti: number;
}

/** Words that only appear in a header, never in a data row. */
const HEADER_HINT_RE = /\b(sr|s\.?\s?no|sr\.?\s?no|sku|material|product|qty|quantity|sti|description)\b/i;

/** A whole, non-negative integer, with optional thousands separators. */
function parseCount(field: string): number | null {
  const cleaned = field.replace(/,/g, "").trim();
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number.parseInt(cleaned, 10);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Tab wins whenever a tab is present anywhere in the block.
 *
 * A copy out of Excel is always tab-separated, and a product description can
 * legitimately contain a comma — so preferring tab is the safe direction:
 * mis-reading a tabbed paste as CSV would split one column into several,
 * whereas the reverse cannot happen (a true CSV has no tabs to find).
 */
function detectDelimiter(block: string): "tab" | "comma" {
  return block.includes("\t") ? "tab" : "comma";
}

function splitFields(line: string, delimiter: "tab" | "comma"): string[] {
  const parts = line.split(delimiter === "tab" ? "\t" : ",").map((f) => f.trim());
  // Excel pads short rows with empty trailing cells; they are not columns.
  while (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/**
 * Does this field look like an Sr no rather than a SKU?
 *
 * Sr numbers are small counters (1, 2, … 42). SAP material codes are seven
 * digits ("5575910") or letter-prefixed ("IN28129271"). Four digits is the
 * cut-off — comfortably above any real line count, comfortably below any
 * material code.
 *
 * ⚠ This width test is what makes the column shape decidable. Testing merely
 * "is it a number" cannot separate an Sr-no column from a numeric SKU in the
 * first column, and guessing wrong there swaps the SKU and quantity columns.
 */
function looksLikeSrNo(field: string): boolean {
  return /^\d{1,4}$/.test(field.trim());
}

/**
 * Read one row's fields into sku + qty (+ optional Sr no).
 *
 * Column shape is decided by the FIRST field only:
 *   2 fields                         → SKU, Qty
 *   3+ fields, [0] looks like an Sr no → Sr, SKU, Qty  (extras ignored)
 *   3+ fields otherwise                → SKU, Qty      (extras ignored)
 *
 * ⚠ ONCE THE SR-NO SHAPE IS CHOSEN, A BAD QUANTITY IS AN ERROR — the row is
 * never silently re-read as a two-column row. It used to be, and a smoke test
 * caught what that costs: "2 ⇥ 5579816 ⇥ abc" (a typo'd quantity) fell through
 * to the two-column branch and parsed as SKU "2", quantity 5,579,816. A row
 * that cannot be read must SAY so — a wrong row that looks fine is far worse
 * than a flagged one, on a sheet somebody signs.
 */
function readFields(fields: string[]): { srNo: number | null; skuCode: string; qtySti: number } | string {
  if (fields.length < 2) return "Needs at least a SKU and a quantity.";

  let srNo: number | null = null;
  let skuField: string;
  let qtyField: string;

  if (fields.length >= 3 && looksLikeSrNo(fields[0])) {
    srNo = parseCount(fields[0]);
    skuField = fields[1];
    qtyField = fields[2];
  } else {
    skuField = fields[0];
    qtyField = fields[1];
  }

  // Trim, collapse any internal whitespace, and upper-case. SAP material codes
  // are upper-case by convention ("IN28129271"), and `sku_master_v2.material`
  // stores them that way — a lower-cased paste would otherwise resolve to
  // nothing and render every line as "Not in catalog" for a reason the operator
  // could not see. Normalising here keeps the catalog lookup a plain equality
  // match instead of a case-insensitive scan.
  const skuCode = skuField.replace(/\s+/g, " ").trim().toUpperCase();
  if (skuCode === "") return "No SKU code in this row.";

  const qtySti = parseCount(qtyField);
  if (qtySti === null) return `"${qtyField}" is not a whole quantity.`;

  return { srNo, skuCode, qtySti };
}

/**
 * Parse a pasted block.
 *
 * Header detection is a REAL TEST, not an assumption that row 1 is one: a row
 * is treated as a header only when it fails to parse as data AND reads like a
 * header. A first row that fails for any other reason comes back as an error,
 * which is what the operator needs to see.
 */
export function parsePastedLines(block: string): MrnPasteResult {
  const delimiter = detectDelimiter(block);
  const lines = block
    .split(/\r\n|\r|\n/)
    .map((l, i) => ({ raw: l, sourceRow: i + 1 }))
    .filter((l) => l.raw.trim() !== "");

  const staged: StagedRow[] = [];
  const errors: MrnPasteError[] = [];
  let headerSkipped = false;

  // Indexed loop, not `lines.entries()` — the tsconfig target is below ES2015,
  // so an array iterator needs Array.from() or downlevelIteration (CORE §3).
  // The index is load-bearing: only row 0 may be a header.
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fields = splitFields(line.raw, delimiter);
    const read = readFields(fields);

    if (typeof read === "string") {
      // Only the FIRST row can be a header, and only if it also looks like one.
      if (index === 0 && !headerSkipped && HEADER_HINT_RE.test(line.raw)) {
        headerSkipped = true;
        continue;
      }
      errors.push({ sourceRow: line.sourceRow, raw: line.raw, message: read });
      continue;
    }

    staged.push({ sourceRow: line.sourceRow, ...read });
  }

  // Keep the sheet's own Sr numbers only when ALL of them are present, positive
  // and distinct — anything less and UNIQUE(mrnId, lineNo) would reject the
  // save. Falling back is silent on the wire but reported via `numbering`.
  const srNos = staged.map((r) => r.srNo);
  const usablePasted =
    staged.length > 0 &&
    srNos.every((s): s is number => s !== null && s > 0) &&
    new Set(srNos).size === staged.length;

  const rows: MrnPasteRow[] = staged.map((r, i) => ({
    lineNo: usablePasted ? (r.srNo as number) : i + 1,
    skuCode: r.skuCode,
    qtySti: r.qtySti,
    sourceRow: r.sourceRow,
  }));

  return {
    rows,
    errors,
    headerSkipped,
    delimiter,
    numbering: usablePasted ? "pasted" : "sequential",
  };
}
