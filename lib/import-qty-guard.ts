// lib/import-qty-guard.ts
//
// Header-vs-lines quantity guard for the two HEADER-SOURCED import paths.
// Both take their OBD total from a header field (`UnitQty`) and their stock
// from a separate line array, and until 2026-09-08 nothing compared the two.
//
// The two ingest points are `processAutoImportRows` (?action=auto,
// ?action=auto-json) and — despite its name — `handlePreview`
// (?action=preview, the manual-template path). `handlePreview` is NOT a dry
// run: it creates the import_batches row and writes both import_raw_summary
// and import_raw_line_items. `handleConfirm` never sees a payload at all; it
// reads those summaries back by id and promotes the chosen ones into `orders`,
// so there is nothing there to compare and the guard cannot live in it.
//
// WHY THIS EXISTS
// Ten live bills hold ZERO line rows while carrying an invoice, nine of them
// dispatched; nine more are short against their own header by 175, 37, 469,
// 50, 50, 50, 211, 50 and 36 units — four shortfalls of exactly 50, which is a
// dropped 50-unit line, not a unit-of-measure error. GUARD 1 in the auto path
// only checks that `createMany` wrote as many rows as it was handed; it cannot
// see lines that never arrived in the payload at all. Full working:
// docs/prompts/drafts/code-discovery-2026-09-08-import-qty-integrity.md
// (§DEFECT B — GATE, Gate 3).
//
// THIS IS A MEASUREMENT PASS. It records and does not block. Same rows are
// written, same batch outcome, same response shape, nothing is rejected. We
// block only once the true rate is known.
//
// NOT wired into manual-SAP on purpose: the 19-column SAP layout has no header
// quantity column, and `build-obd.ts:65` derives the OBD total by summing the
// very lines that would be compared against it — self-consistent by
// construction, so the comparison would be vacuous.

import { prisma } from "./prisma";

/** One payload whose declared header quantity disagrees with its own lines. */
export interface QtyMismatch {
  obdNumber:  string;
  /** The header's `UnitQty` — what the source system claimed it sent. */
  declared:   number;
  /** Sum of `unitQty` over the line array that actually arrived. */
  observed:   number;
  /** declared − observed. Positive = lines are SHORT (the failure we are hunting). */
  difference: number;
  /** How many line rows arrived — 0 is the ten-bill case. */
  lineCount:  number;
  /** The summary rowStatus this OBD carries, so duplicates can be split out in analysis. */
  rowStatus:  string;
}

/**
 * Compare a payload header's declared `UnitQty` against the sum of the line
 * array it arrived with. Returns null when there is nothing to report.
 *
 * `declared === null` or `0` is EXEMPT and returns null: that is "the source
 * said nothing", not "the source disagreed". Blank header quantities are
 * common and are not evidence of loss.
 *
 * Pure — no I/O, no clock. Called once per OBD by both header-sourced paths.
 */
export function detectQtyMismatch(
  obdNumber: string,
  declared:  number | null,
  lines:     ReadonlyArray<{ unitQty: number }>,
  rowStatus: string,
): QtyMismatch | null {
  if (declared === null || declared === 0) return null;
  const observed = lines.reduce((sum, l) => sum + l.unitQty, 0);
  if (observed === declared) return null;
  return {
    obdNumber,
    declared,
    observed,
    difference: declared - observed,
    lineCount:  lines.length,
    rowStatus,
  };
}

/**
 * The sentence appended to `import_raw_summary.rowError`.
 *
 * The `[qty_mismatch]` prefix is the greppable handle — it is NOT written to
 * `rowStatus`. See the note on writeQtyMismatchRecords() for why.
 */
export function qtyMismatchNote(m: QtyMismatch): string {
  return `[qty_mismatch] header UnitQty ${m.declared} vs line sum ${m.observed} ` +
         `across ${m.lineCount} line(s); difference ${m.difference}`;
}

/** Append the note to an existing rowError without clobbering what is there. */
export function appendRowError(existing: string | null, note: string): string {
  return existing ? `${existing} · ${note}` : note;
}

// ─── Anomalies ────────────────────────────────────────────────────────────
//
// One shape for everything this module records, so the shadow-log write and
// the batch-label append have a single implementation. A batch that hits both
// kinds must produce ONE label update — two writes would each rebuild the
// label from the original and the second would erase the first.

export interface ImportAnomaly {
  obdNumber: string;
  /** `import_shadow_log.shadowOutcome` — the greppable kind. */
  outcome:   "qty_mismatch" | "empty_payload_skipped";
  /** `import_shadow_log.actualOutcome` — what happened to the bill itself. */
  actual:    "imported" | "skipped";
  note:      string;
  decision:  Record<string, unknown>;
  /** Compact form for the batch label, e.g. `9109296263(75→0)`. */
  labelPart: string;
}

/** A recorded qty mismatch — the bill WAS imported, numbers disagree. */
export function toQtyMismatchAnomaly(m: QtyMismatch): ImportAnomaly {
  return {
    obdNumber: m.obdNumber,
    outcome:   "qty_mismatch",
    actual:    "imported",
    note:      qtyMismatchNote(m),
    decision:  {
      declared: m.declared, observed: m.observed,
      difference: m.difference, lineCount: m.lineCount, rowStatus: m.rowStatus,
    },
    labelPart: `${m.obdNumber}(${m.declared}→${m.observed})`,
  };
}

/**
 * An OBD dropped before any row was written because its payload carried no
 * lines. The bill is NOT created — deliberately, so the create-only auto path
 * can pick it up again on the next cycle instead of being locked out by an
 * existing-but-empty order it can never fill.
 */
export function toEmptyPayloadAnomaly(obdNumber: string, declared: number | null): ImportAnomaly {
  return {
    obdNumber,
    outcome:   "empty_payload_skipped",
    actual:    "skipped",
    note:      `[empty_payload] payload carried 0 line rows (header UnitQty ${declared ?? "null"}); ` +
               `OBD not created so a later cycle can retry it`,
    decision:  { declared, observed: 0, lineCount: 0 },
    labelPart: `${obdNumber}(${declared ?? "null"})`,
  };
}

/**
 * Persist the batch's mismatches: one `import_shadow_log` row each, plus a
 * human-readable warning appended to the batch's own label.
 *
 * ⚠ `import_raw_summary.rowStatus` IS DELIBERATELY NOT TOUCHED. A gate run on
 * 2026-09-08 found live code that branches on it, and a new value would not be
 * inert — it would be destructive:
 *   - route.ts:2851 and :2878-2880 whitelist `rowStatus in ("valid","warning")`
 *     before turning a summary into an `orders` row. Any other value and the
 *     bill never becomes an order at all, i.e. it vanishes from the app.
 *   - route.ts:1043-1045 applies the same whitelist on the manual-template path.
 *   - route.ts:1185 and :3038 derive `orders.customerMissing` from
 *     `rowStatus === "warning"`, so overwriting it would silently clear a real
 *     unknown-customer flag.
 *   - route.ts:1402-1405 counts `skippedObds`/`failedObds` off it.
 * The mismatch therefore lives in `rowError` (free text, read by nothing) and
 * in `import_shadow_log`. Both are additive.
 *
 * Sequential awaits, no `prisma.$transaction` (CLAUDE_CORE.md §3). Never
 * throws into the caller: a measurement pass must not be able to fail an
 * import that otherwise succeeded.
 */
export async function writeImportAnomalies(
  batchId:         number,
  batchRef:        string,
  source:          string,
  batchFileLabel:  string,
  anomalies:       ImportAnomaly[],
): Promise<void> {
  if (anomalies.length === 0) return;

  try {
    await prisma.import_shadow_log.createMany({
      data: anomalies.map((a) => ({
        batchId,
        obdNumber:     a.obdNumber,
        source,
        actualOutcome: a.actual,
        shadowOutcome: a.outcome,
        decision:      { batchRef, ...a.decision },
        errors:        a.note,
      })),
    });
  } catch (err) {
    console.error("[qty-guard] shadow-log write failed", { batchRef, count: anomalies.length }, err);
  }

  // Human-readable warning on the batch record. `import_batches` has no
  // free-text status column (CLAUDE_IMPORT.md §4 lists an `errorMessage` that
  // the live schema does not have), and `headerFile` is the label a human
  // already reads to tell batches apart. Appending keeps the existing
  // `[auto-import] …` / `[templateId] …` prefix intact, so every LIKE-prefix
  // query still matches.
  const parts: string[] = [];
  for (const kind of ["qty_mismatch", "empty_payload_skipped"] as const) {
    const of = anomalies.filter((a) => a.outcome === kind);
    if (of.length === 0) continue;
    const listed = of.slice(0, 5).map((a) => a.labelPart).join(", ");
    const more   = of.length > 5 ? ` +${of.length - 5} more` : "";
    const name   = kind === "qty_mismatch" ? "qty-mismatch" : "empty-skip";
    parts.push(`${name} x${of.length}: ${listed}${more}`);
  }
  const label = `${batchFileLabel} ⚠ ${parts.join(" · ")}`;

  try {
    await prisma.import_batches.update({
      where: { id: batchId },
      // Postgres text has no practical length limit, but keep the label sane.
      data:  { headerFile: label.slice(0, 900) },
    });
  } catch (err) {
    console.error("[qty-guard] batch label update failed", { batchRef }, err);
  }
}
