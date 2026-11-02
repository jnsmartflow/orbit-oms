// lib/stock-audit/calc.ts
//
// The stock-count calculator: ONE place for the arithmetic, the "working"
// string and the validation, so the phone (live formula above Submit), the
// counter's line routes (which recompute the total and never trust the
// client's) and the desk ledger can never disagree.
//
// 🔴 PURE — NO Prisma, NO server imports, NO React. The phone screen imports
// this file by value; anything server-only pulled in here would ship to the
// browser.
//
// 🔴 IT MUST MATCH THE DATABASE EXACTLY. The live CHECKs on stock_audit_lines
// (Schema v27.78, CORE §7.20), in Postgres normal form:
//
//   chk_stock_audit_lines_total   CHECK ((("totalPcs" > 0) AND (("totalPcs")::bigint =
//       (((((stack)::bigint * (rows)::bigint) * (depth)::bigint)
//         * (COALESCE("pcsPerCarton", 1))::bigint) + (loose)::bigint))))
//   chk_stock_audit_lines_carton  pieces ⇒ "pcsPerCarton" IS NULL;
//                                 cartons ⇒ "pcsPerCarton" > 0
//   chk_stock_audit_lines_nonneg  stack, rows, depth, loose >= 0
//
// so: total = stack × rows × depth × (pcsPerCarton ?? 1) + loose, and > 0.
// Every column is a Postgres `integer` (int4), so each field AND the total must
// also fit in 2,147,483,647 — a bigger total passes the bigint CHECK but fails
// the INSERT with an int4 overflow. validateLineInput refuses it first.
//
// Zero-total lines are refused (Smart Flow, 2026-11-02).
//
// BLANK FACTORS (Smart Flow, 2026-11-02 — "calc order + blank-as-1"):
//   · the screen order is Stack × Depth × Rows (× Pcs/carton) + Loose;
//   · a BLANK stack / depth / rows counts as 1 — unless ALL THREE are blank,
//     then all three are 0 and the line is loose only;
//   · a TYPED 0 stays 0 (and hides the stacked part);
//   · Pcs/carton is NOT one of the three: in Cartons mode it stays REQUIRED and
//     a blank one never becomes 1. Loose blank is 0.
// The RESOLVED numbers are what is saved, so chk_stock_audit_lines_total holds
// with no DDL. A typed 1 and a blank 1 are the same saved row, on purpose.

import { COUNT_MODE, isCountMode, type CountMode } from "./status";

/** Largest value a Postgres `integer` column holds. */
export const INT4_MAX = 2_147_483_647;

/** A line's working, already validated. pcsPerCarton is null in pieces mode. */
export interface CountWorking {
  mode: CountMode;
  stack: number;
  rows: number;
  depth: number;
  pcsPerCarton: number | null;
  loose: number;
}

/**
 * stack × rows × depth × (pcsPerCarton ?? 1) + loose — the CHECK's formula.
 * Exact for any input validateLineInput accepts (every partial product is
 * capped at INT4_MAX there, far inside Number's safe-integer range). Pieces
 * mode multiplies by 1 even if a stray pcsPerCarton is passed, exactly as the
 * CHECK's COALESCE would on a NULL — but the CHECK refuses a carton size in
 * pieces mode, so validateLineInput does too.
 */
export function computeTotal(w: CountWorking): number {
  const carton = w.mode === COUNT_MODE.cartons ? (w.pcsPerCarton ?? 1) : 1;
  return w.stack * w.rows * w.depth * carton + w.loose;
}

/**
 * The working as the ledger shows it, in SCREEN order — stack × depth × rows
 * (× pcs/carton) + loose: "4 × 2 × 10 × 12 + 5". The saved numbers exactly,
 * resolved 1s included ("4 × 1 × 1").
 *   · pieces mode omits the carton factor          → "4 × 2 × 10 + 5"
 *   · loose is shown only when > 0                 → "4 × 2 × 10 × 12"
 *   · a zero stack/depth/rows means no product part → loose alone, "5"
 */
export function formatWorking(w: CountWorking): string {
  const factors = [w.stack, w.depth, w.rows];
  if (w.mode === COUNT_MODE.cartons && w.pcsPerCarton !== null) factors.push(w.pcsPerCarton);
  const hasProduct = factors.every((n) => n > 0);
  const parts: string[] = [];
  if (hasProduct) parts.push(factors.join(" × "));
  if (w.loose > 0) parts.push(String(w.loose));
  return parts.length > 0 ? parts.join(" + ") : "0";
}

export type LineField = "mode" | "stack" | "rows" | "depth" | "pcsPerCarton" | "loose" | "total";

export interface LineError {
  field: LineField;
  message: string;
}

export type LineValidation =
  | { ok: true; working: CountWorking; totalPcs: number }
  | { ok: false; errors: LineError[] };

/** What a phone form or a JSON body may hand in — strings from inputs, or numbers. */
export interface RawLineInput {
  mode: unknown;
  stack?: unknown;
  rows?: unknown;
  depth?: unknown;
  pcsPerCarton?: unknown;
  loose?: unknown;
}

const FIELD_LABEL: Record<"stack" | "rows" | "depth" | "pcsPerCarton" | "loose", string> = {
  stack: "Stack",
  rows: "Rows",
  depth: "Depth",
  pcsPerCarton: "Pcs per carton",
  loose: "Loose pcs",
};

type Parsed = { ok: true; value: number | null } | { ok: false; message: string };

/**
 * A whole number 0…INT4_MAX. Blank (undefined, null, "") → null, which the
 * caller resolves (resolveFactors · loose 0 · "no carton size"). A number or a digits-only string —
 * the phone's inputmode="numeric" fields arrive as strings.
 */
function parseCount(raw: unknown, label: string): Parsed {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s === "") return { ok: true, value: null };
    if (!/^[0-9]+$/.test(s)) return { ok: false, message: `${label} must be a whole number` };
    const n = Number(s);
    if (n > INT4_MAX) return { ok: false, message: `${label} is too large` };
    return { ok: true, value: n };
  }
  if (typeof raw === "number") {
    if (!Number.isInteger(raw)) return { ok: false, message: `${label} must be a whole number` };
    if (raw < 0) return { ok: false, message: `${label} cannot be negative` };
    if (raw > INT4_MAX) return { ok: false, message: `${label} is too large` };
    return { ok: true, value: raw };
  }
  return { ok: false, message: `${label} must be a whole number` };
}

/**
 * The blank rule for the three stacking factors (null = blank):
 * all three blank → 0 / 0 / 0 (loose only); otherwise blank → 1. A typed
 * number (0 included) is kept as typed.
 */
export function resolveFactors(f: { stack: number | null; depth: number | null; rows: number | null }): {
  stack: number;
  depth: number;
  rows: number;
} {
  if (f.stack === null && f.depth === null && f.rows === null) return { stack: 0, depth: 0, rows: 0 };
  return { stack: f.stack ?? 1, depth: f.depth ?? 1, rows: f.rows ?? 1 };
}

/**
 * Validate and normalise one line's working. Returns the working the server
 * should write and the total it computed, or every error at once (so the phone
 * can mark each field). Blank factors resolve by resolveFactors; blank loose
 * is 0; a blank pcs/carton in Cartons mode is refused.
 */
export function validateLineInput(input: RawLineInput): LineValidation {
  const errors: LineError[] = [];

  if (!isCountMode(input.mode)) {
    errors.push({ field: "mode", message: "Choose Pieces or Cartons" });
  }

  const nums: Record<"stack" | "rows" | "depth" | "pcsPerCarton" | "loose", number | null> = {
    stack: null, rows: null, depth: null, pcsPerCarton: null, loose: null,
  };
  for (const field of ["stack", "rows", "depth", "pcsPerCarton", "loose"] as const) {
    const parsed = parseCount(input[field], FIELD_LABEL[field]);
    if (parsed.ok) nums[field] = parsed.value;
    else errors.push({ field, message: parsed.message });
  }

  if (isCountMode(input.mode)) {
    if (input.mode === COUNT_MODE.cartons) {
      if (nums.pcsPerCarton === null || nums.pcsPerCarton <= 0) {
        if (!errors.some((e) => e.field === "pcsPerCarton")) {
          errors.push({ field: "pcsPerCarton", message: "Cartons needs pcs per carton above 0" });
        }
      }
    } else if (nums.pcsPerCarton !== null) {
      errors.push({ field: "pcsPerCarton", message: "Pieces mode does not take pcs per carton" });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const resolved = resolveFactors({ stack: nums.stack, depth: nums.depth, rows: nums.rows });
  const working: CountWorking = {
    mode: input.mode as CountMode,
    stack: resolved.stack,
    rows: resolved.rows,
    depth: resolved.depth,
    pcsPerCarton: input.mode === COUNT_MODE.cartons ? nums.pcsPerCarton : null,
    loose: nums.loose ?? 0,
  };

  // Each partial product is checked against INT4_MAX before the next multiply,
  // so no intermediate value ever leaves Number's exact range.
  let product = 1;
  const factors = [working.stack, working.depth, working.rows];
  if (working.pcsPerCarton !== null) factors.push(working.pcsPerCarton);
  for (const f of factors) {
    product *= f;
    if (product > INT4_MAX) {
      return { ok: false, errors: [{ field: "total", message: "Total is too large — check the numbers" }] };
    }
  }
  const totalPcs = product + working.loose;
  if (totalPcs > INT4_MAX) {
    return { ok: false, errors: [{ field: "total", message: "Total is too large — check the numbers" }] };
  }
  if (totalPcs <= 0) {
    return { ok: false, errors: [{ field: "total", message: "Total must be more than 0" }] };
  }

  return { ok: true, working, totalPcs };
}

/**
 * The phone's live preview while typing — the SAME blank rule as
 * validateLineInput. `total` is null until any of stack / depth / rows / loose
 * has a value, and in Cartons mode until pcs/carton is above 0 (it never
 * defaults). An unparseable box counts as blank here; validateLineInput still
 * refuses it on Submit.
 */
export function previewLine(input: RawLineInput): { working: string; total: number | null } {
  const num = (raw: unknown): number | null => {
    const p = parseCount(raw, "");
    return p.ok ? p.value : null;
  };
  const stack = num(input.stack);
  const depth = num(input.depth);
  const rows = num(input.rows);
  const loose = num(input.loose);
  const cartons = input.mode === COUNT_MODE.cartons;
  const ppc = cartons ? num(input.pcsPerCarton) : null;
  const f = resolveFactors({ stack, depth, rows });
  const w: CountWorking = {
    mode: cartons ? COUNT_MODE.cartons : COUNT_MODE.pieces,
    stack: f.stack,
    rows: f.rows,
    depth: f.depth,
    pcsPerCarton: ppc,
    loose: loose ?? 0,
  };
  const any = stack !== null || depth !== null || rows !== null || loose !== null;
  const cartonOk = !cartons || (ppc !== null && ppc > 0);
  return { working: formatWorking(w), total: any && cartonOk ? computeTotal(w) : null };
}

/**
 * The phone sends `clientTotal` — the total it SHOWED the counter. The server
 * computes its own (always the one saved) and refuses the line when the two
 * differ, or when none is sent: a phone still running an older page (blank
 * read as 0) must never save a number the counter did not see.
 * → 400 TOTAL_MISMATCH "The app was updated — reopen the screen".
 */
export function clientTotalMatches(clientTotal: unknown, serverTotal: number): boolean {
  return typeof clientTotal === "number" && Number.isInteger(clientTotal) && clientTotal === serverTotal;
}
