// lib/sap-paste/index.ts
//
// Public entry point for the SAP CLIPBOARD import — the paste counterpart of
// lib/sap-parser/index.ts, which it mirrors step for step:
//
//   readPaste()    → flat RawSapRow[]  (replaces readSheet — the ONLY new stage)
//   groupRows()    → bucket by Delivery + non-LF skip rule      (UNCHANGED)
//   applyRules()   → category routing + qty / parent rules      (UNCHANGED)
//   buildObds()    → assemble ObdInput[] from interims          (UNCHANGED)
//
// ⚠ ASYNC, FOR THE SAME REASON parseSapFile IS. buildObds() reads the
// sku_master_v2 pack catalog ONCE per paste to resolve article/articleTag
// (lib/article-tag.ts). This file holds no DB code of its own; that single
// read happens inside the unchanged buildObds, exactly as on the .xlsx path.
//
// Unlike parseSapFile, a bad input does not throw: an unreadable paste comes
// back as `{ kind: "blocked" }` with every per-line error, and NOTHING from a
// blocked paste may be imported (see read-paste.ts for why).
//
// Customer names are returned as the screen shows them — possibly cut off at
// PASTE_NAME_WIDTHS. Resolving the full name is a separate, DB-backed step.

import { readPaste, type PasteRowError } from "./read-paste";
import { groupRows } from "../sap-parser/group-rows";
import { applyRules } from "../sap-parser/apply-rules";
import { buildObds } from "../sap-parser/build-obd";
import type { ParseResult, Warning } from "../sap-parser/types";

export { readPaste, PASTE_NAME_WIDTHS } from "./read-paste";
export type { PasteRowError, ReadPasteResult } from "./read-paste";

export type SapPasteParseResult =
  | { kind: "ok"; result: ParseResult }
  | { kind: "blocked"; error: string; errors: PasteRowError[] };

/**
 * Parse a pasted SAP OBD screen list into ObdInput objects.
 *
 * `fallbackObdEmailDate` is the date the operator picked — stamped on every
 * OBD, exactly as for the .xlsx (the list has no email-date column).
 */
export async function parseSapPaste(
  block:   string,
  options: { fallbackObdEmailDate: Date },
): Promise<SapPasteParseResult> {
  const read = readPaste(block);

  if (read.fatal !== null) {
    return { kind: "blocked", error: read.fatal, errors: read.errors };
  }
  if (read.errors.length > 0) {
    const n = read.errors.length;
    return {
      kind:   "blocked",
      error:  `${n} line${n === 1 ? "" : "s"} could not be read. Nothing was imported - fix ${n === 1 ? "it" : "them"} and paste again.`,
      errors: read.errors,
    };
  }

  const grouped = groupRows(read.rows);
  const applied = applyRules(grouped.groups);
  const built   = await buildObds(grouped.groups, applied, options.fallbackObdEmailDate);

  const skipped = [
    ...grouped.skipped,
    ...applied.skipped,
    ...built.skipped,
  ];

  // readPaste raises no warnings — every problem it finds blocks instead.
  const warnings: Warning[] = [
    ...grouped.warnings,
    ...applied.warnings,
    ...built.warnings,
  ];

  const fileStats = {
    totalRows:         read.totalRows,
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
    kind: "ok",
    result: {
      obds: built.obds,
      skipped,
      warnings,
      fileStats,
    },
  };
}
