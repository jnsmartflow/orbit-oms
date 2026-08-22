// lib/mrn/derive.ts
//
// Every derived MRN value, in one place. PURE — no Prisma, no I/O, no clock
// read. Importable from a server module, a route handler and a client component
// alike, which is the point: the phone validates a line with the same function
// the write route validates it with, so the two can never disagree about
// whether a line is confirmable.
//
// 🔴 THERE IS NO BEST-BEFORE ANYTHING IN THIS FILE, AND NONE MAY BE ADDED.
// As of 2026-08-22 the supervisor does not record a best-before date at all —
// it is off the line sheet, out of MrnBatchInput, out of the confirm route and
// off every display surface (schema v27.17). Before that it was TYPED per batch
// rather than derived, because shelf life varies by product; before THAT an
// early design computed it as manufacturing + 24 months. Both reversals are
// recorded so neither is re-reversed. Do not add a 24-month helper in any
// direction — not as a default, not as a pre-fill, not "unused for now". An
// unused helper is an invitation.

import type {
  MrnBatchInput,
  MrnConditionCounts,
  MrnIssueSummary,
  MrnLineDerived,
} from "./types";

// ── Short / Excess ───────────────────────────────────────────────────────────
//
// DERIVED AT READ AND EXPORT TIME. There are no shortQty / excessQty columns on
// mrn_lines and none may be added (design §11 OQ-2): storing them would let the
// card, the table, the XLS and the print sheet drift into disagreeing about the
// same truck.

/** The line's own quantity inputs — the minimum needed to derive Short/Excess. */
export interface MrnQtyPair {
  qtySti: number;
  /** null on an unchecked line. 0 is a real value, not "unset". */
  physicalQty: number | null;
}

/**
 * How many fewer arrived than the STI promised.
 *
 * Returns 0 on an UNCHECKED line (physicalQty null) — nobody has counted yet,
 * so there is no shortage to report. That is deliberately different from a line
 * confirmed AT ZERO, which is a real receipt of nothing and derives to the full
 * qtySti (design §11 OQ-4).
 */
export function shortQty({ qtySti, physicalQty }: MrnQtyPair): number {
  if (physicalQty === null) return 0;
  return Math.max(0, qtySti - physicalQty);
}

/** How many more arrived than the STI promised. 0 on an unchecked line. */
export function excessQty({ qtySti, physicalQty }: MrnQtyPair): number {
  if (physicalQty === null) return 0;
  return Math.max(0, physicalQty - qtySti);
}

// ── Per-line issue flag ──────────────────────────────────────────────────────

/** Sum the condition counts that represent something WRONG.
 *
 *  ⚠ sndQty is excluded on purpose. SND is the SOUND count — the tins that
 *  arrived fine. On a clean line sndQty EQUALS physicalQty, so folding it in
 *  would flag every healthy line as an issue. */
function badConditionTotal(counts: MrnConditionCounts): number {
  return (
    (counts.leakyQty ?? 0) +
    (counts.damageQty ?? 0) +
    (counts.emptyQty ?? 0) +
    (counts.qtdQty ?? 0) +
    (counts.rejQty ?? 0)
  );
}

export type MrnDerivableLine = MrnQtyPair & MrnConditionCounts;

/**
 * The three derived values for one line.
 *
 * An UNCHECKED line is never an issue, whatever counts happen to sit on it —
 * "not looked at yet" and "looked at and wrong" are different states, and only
 * the second one is something billing has to act on.
 */
export function deriveLine(line: MrnDerivableLine): MrnLineDerived {
  const short = shortQty(line);
  const excess = excessQty(line);
  const checked = line.physicalQty !== null;
  return {
    shortQty: short,
    excessQty: excess,
    hasIssue: checked && (short > 0 || excess > 0 || badConditionTotal(line) > 0),
  };
}

/** Convenience predicate for call sites that only want the flag. */
export function lineHasIssue(line: MrnDerivableLine): boolean {
  return deriveLine(line).hasIssue;
}

// ── Per-MRN roll-up ──────────────────────────────────────────────────────────

/**
 * The summary the rail chips and the phone badges render — "All clear" when
 * `issueLineCount` is 0, "{n} issues" otherwise.
 *
 * Counts LINES, not units: a line 3 short and 2 leaky is ONE thing for the
 * operator to look at, not five. The unit totals ride alongside for the report's
 * TOTAL row.
 */
export function summariseMrn(lines: readonly MrnDerivableLine[]): MrnIssueSummary {
  const summary: MrnIssueSummary = {
    issueLineCount: 0,
    totalShort: 0,
    totalExcess: 0,
    totalLeaky: 0,
    totalDamage: 0,
    totalEmpty: 0,
    totalQtd: 0,
    totalRej: 0,
  };

  for (const line of lines) {
    const d = deriveLine(line);
    if (d.hasIssue) summary.issueLineCount += 1;
    summary.totalShort += d.shortQty;
    summary.totalExcess += d.excessQty;
    summary.totalLeaky += line.leakyQty ?? 0;
    summary.totalDamage += line.damageQty ?? 0;
    summary.totalEmpty += line.emptyQty ?? 0;
    summary.totalQtd += line.qtdQty ?? 0;
    summary.totalRej += line.rejQty ?? 0;
  }

  return summary;
}

// ── Batch validation ─────────────────────────────────────────────────────────

export type MrnBatchProblem =
  | "SUM_MISMATCH"
  | "MISSING_BATCHES"
  | "UNEXPECTED_BATCHES"
  | "INVALID_QTY"
  | "INVALID_MONTH";

export interface MrnBatchValidation {
  ok: boolean;
  /** physicalQty — what the batches must add up to. */
  expected: number;
  /** SUM(batch.qty) as submitted. */
  actual: number;
  problem?: MrnBatchProblem;
  /** Operator-facing, safe to render directly in the sheet. */
  message?: string;
}

/**
 * Do this line's manufacturing batches add up, and is each one storable?
 *
 * Returns a STRUCTURED RESULT rather than throwing: the phone renders this
 * live under the batch list ("30 + 16 = 46 · matches qty received ✓") on every
 * keystroke, and an exception is not a UI state.
 *
 * ⚠ physicalQty === 0 is VALID AND TAKES ZERO BATCH ROWS (design §11 OQ-4).
 * The live CHECK `chk_mrn_batch_qty` requires qty > 0 on every row, so a line
 * received at zero simply has none — there is no quantity to attribute and no
 * month to record. Zero batches there is a correct write, not a missing one.
 *
 * The DB enforces none of this cross-column arithmetic (no CHECK can span a
 * parent and its children), so this function IS the enforcement — same class as
 * pick_findings' reason↔mfgMonth rule, which lives in its write routes for the
 * same reason.
 */
export function validateBatches(
  physicalQty: number | null,
  batches: readonly MrnBatchInput[],
): MrnBatchValidation {
  const expected = physicalQty ?? 0;
  const actual = batches.reduce((sum, b) => sum + b.qty, 0);
  const base = { expected, actual };

  if (physicalQty === null) {
    return {
      ...base,
      ok: false,
      problem: "MISSING_BATCHES",
      message: "Enter the physical quantity received before recording batches.",
    };
  }

  // A line received at zero: no batches, and that is the whole rule.
  if (physicalQty === 0) {
    return batches.length === 0
      ? { ...base, ok: true }
      : {
          ...base,
          ok: false,
          problem: "UNEXPECTED_BATCHES",
          message: "Nothing was received on this line, so it cannot carry a manufacturing batch.",
        };
  }

  if (batches.length === 0) {
    return {
      ...base,
      ok: false,
      problem: "MISSING_BATCHES",
      message: "Enter the manufacturing month and year.",
    };
  }

  // Mirrors chk_mrn_batch_qty. Checked here so the operator gets a sentence
  // instead of a raw constraint violation from Postgres.
  if (batches.some((b) => !Number.isInteger(b.qty) || b.qty <= 0)) {
    return {
      ...base,
      ok: false,
      problem: "INVALID_QTY",
      message: "Every batch needs a whole quantity of 1 or more.",
    };
  }

  // Mirrors chk_mrn_batch_mfg_month. There is deliberately NO year check — "a
  // reasonable year" is a UI judgement that ages, not an invariant (the
  // pick_findings precedent).
  //
  // ⚠ THE BEST-BEFORE HALF OF THIS CHECK IS GONE (2026-08-22). It read
  // `|| !monthOk(b.bestBeforeMonth)` and the message named both months. The
  // supervisor no longer records a best-before date at all, so requiring one
  // would block every confirm. chk_mrn_batch_bb_month is still live but passes
  // on NULL. Do not restore this without restoring the input that feeds it.
  const monthOk = (m: number) => Number.isInteger(m) && m >= 1 && m <= 12;
  if (batches.some((b) => !monthOk(b.mfgMonth))) {
    return {
      ...base,
      ok: false,
      problem: "INVALID_MONTH",
      message: "Every batch needs a manufacturing month.",
    };
  }

  if (actual !== expected) {
    return {
      ...base,
      ok: false,
      problem: "SUM_MISMATCH",
      message: `Batch quantities add up to ${actual}, but ${expected} were received.`,
    };
  }

  return { ...base, ok: true };
}

// ── Condition-count validation ───────────────────────────────────────────────

/**
 * SND + Leaky + Damage + Empty must equal the physical qty (design §6.4) —
 * the check that stops the condition split and the quantity drifting apart.
 *
 * ⚠ QTD and REJ are deliberately OUTSIDE this sum. They are carried because the
 * source workbook carries them, and QTD's meaning is genuinely unknown (design
 * §4), so folding an unknown into an arithmetic invariant would be inventing a
 * rule nobody has confirmed. The mockup's own banner states the four-way sum.
 *
 * Returns null when the operator has not opened the issue toggle at all (every
 * count still null) — that is the clean path, not a validation failure.
 */
export function validateConditionCounts(
  physicalQty: number | null,
  counts: MrnConditionCounts,
): MrnBatchValidation | null {
  const touched =
    counts.sndQty !== null ||
    counts.leakyQty !== null ||
    counts.damageQty !== null ||
    counts.emptyQty !== null;
  if (!touched) return null;

  const expected = physicalQty ?? 0;
  const actual =
    (counts.sndQty ?? 0) + (counts.leakyQty ?? 0) + (counts.emptyQty ?? 0) + (counts.damageQty ?? 0);

  return actual === expected
    ? { ok: true, expected, actual }
    : {
        ok: false,
        expected,
        actual,
        problem: "SUM_MISMATCH",
        message: `SND + Leaky + Damage + Empty add up to ${actual}, but ${expected} were received.`,
      };
}
