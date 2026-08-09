// lib/sap-parser/index.ts
//
// Public entry point for the SAP OBT XLSX parser. Reads a workbook from a
// buffer, applies skip/category/qty rules, and returns ObdInput[] ready for
// upsertObd plus warnings + skipped tallies + file-level stats.
//
// ASYNC as of 2026-08-09. readSheet/groupRows/applyRules are still pure and
// synchronous; only the final buildObds() step touches the DB, to resolve
// article/articleTag against sku_master_v2 (lib/article-tag.ts). It reads
// the catalog ONCE per file — the parser is still one query per upload, not
// one per line, and still writes nothing.
//
// Pipeline:
//   readSheet()    → flat RawSapRow[] with header validation
//   groupRows()    → bucket by Delivery + apply non-LF skip rule
//   applyRules()   → category routing + two-tier qty rule per delivery
//   buildObds()    → assemble ObdInput[] from interims
//
// All errors are file-tolerant: malformed rows produce warnings; only
// truly broken inputs (corrupt file, missing required header columns)
// throw FileParseError or FileFormatError.

import { readSheet } from "./read-sheet";
import { groupRows } from "./group-rows";
import { applyRules } from "./apply-rules";
import { buildObds } from "./build-obd";
import type { ParseOptions, ParseResult, Warning } from "./types";

// Re-export the public surface so callers can do
//   `import { parseSapFile, ParseResult, FileParseError } from "@/lib/sap-parser"`.
export type {
  ParseOptions,
  ParseResult,
  SkippedRow,
  Warning,
  WarningKind,
} from "./types";
export { FileParseError, FileFormatError } from "./types";

/**
 * Parse a SAP OBT XLSX export into a list of ObdInput objects.
 *
 * No HTTP, no auth, no writes, no Date.now(). ONE read: buildObds() loads the
 * sku_master_v2 pack columns for the file's SKUs to resolve article/articleTag
 * (see lib/article-tag.ts). Everything before that stage is still pure.
 *
 * Throws FileParseError when the buffer is not a readable workbook.
 * Throws FileFormatError when the workbook is missing the target sheet
 * or the header row is missing required column positions.
 *
 * Per-row issues never throw — they appear in `result.warnings` with
 * an actionable `kind`, `message`, and the source row numbers.
 */
export async function parseSapFile(
  buffer:  ArrayBuffer | Buffer,
  options: ParseOptions,
): Promise<ParseResult> {
  const { rows, totalRows, warnings: readWarnings } = readSheet(buffer, options.sheetName);
  const grouped = groupRows(rows);
  const applied = applyRules(grouped.groups);
  const built   = await buildObds(grouped.groups, applied, options.fallbackObdEmailDate);

  const skipped = [
    ...grouped.skipped,
    ...applied.skipped,
    ...built.skipped,
  ];

  const warnings: Warning[] = [
    ...readWarnings,
    ...grouped.warnings,
    ...applied.warnings,
    ...built.warnings,
  ];

  const fileStats = {
    totalRows,
    uniqueDeliveries:  grouped.uniqueDeliveries.size,
    createdObds:       built.obds.length,
    skippedDeliveries: skipped.length,
  };

  // Stats invariant — log a warning rather than throwing (file-tolerance).
  if (fileStats.createdObds + fileStats.skippedDeliveries !== fileStats.uniqueDeliveries) {
    warnings.push({
      kind:    "stats-mismatch",
      message: `stats invariant failed: createdObds(${fileStats.createdObds}) + skippedDeliveries(${fileStats.skippedDeliveries}) !== uniqueDeliveries(${fileStats.uniqueDeliveries})`,
      rowNumbers: [],
    });
  }

  return {
    obds:    built.obds,
    skipped,
    warnings,
    fileStats,
  };
}
