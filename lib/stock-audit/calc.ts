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
 * The working as the ledger shows it: "4 × 10 × 2 × 12 + 5".
 *   · pieces mode omits the carton factor          → "4 × 10 × 2 + 5"
 *   · loose is shown only when > 0                 → "4 × 10 × 2 × 12"
 *   · a zero stack/rows/depth means no product part → loose alone, "5"
 */
export function formatWorking(w: CountWorking): string {
  const factors = [w.stack, w.rows, w.depth];
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
 * caller turns into 0 or "no carton size". A number or a digits-only string —
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
 * Validate and normalise one line's working. Returns the working the server
 * should write and the total it computed, or every error at once (so the phone
 * can mark each field). Blank stack / rows / depth / loose read as 0.
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

  const working: CountWorking = {
    mode: input.mode as CountMode,
    stack: nums.stack ?? 0,
    rows: nums.rows ?? 0,
    depth: nums.depth ?? 0,
    pcsPerCarton: input.mode === COUNT_MODE.cartons ? nums.pcsPerCarton : null,
    loose: nums.loose ?? 0,
  };

  // Each partial product is checked against INT4_MAX before the next multiply,
  // so no intermediate value ever leaves Number's exact range.
  let product = 1;
  const factors = [working.stack, working.rows, working.depth];
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
