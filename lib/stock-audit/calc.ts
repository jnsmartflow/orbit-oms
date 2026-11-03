// lib/stock-audit/calc.ts
//
// The stock-count quantity rule: ONE place for it, so the phone (Submit is
// enabled only for a good number) and the counter's line routes (which
// validate the body again and never trust the phone) cannot disagree.
//
// v27.79 (Smart Flow, 2026-11-03): entry is ONE number, "Qty (pcs)". No
// calculator, no Pieces/Cartons, no stack/depth/rows/pcs-per-carton/loose —
// counters do the maths off the app. Qty is ALWAYS pieces.
//
// 🔴 PURE — NO Prisma, NO server imports, NO React. The phone screen imports
// this file by value; anything server-only pulled in here would ship to the
// browser.
//
// 🔴 IT MUST MATCH THE DATABASE: chk_stock_audit_lines_qty CHECK ("qty" > 0)
// (Schema v27.79, CORE §7.20). The column is a Postgres `integer` (int4), so
// the qty must also fit in 2,147,483,647 — a bigger one would fail the INSERT
// with an int4 overflow, so it is refused here first. Zero is refused
// (Smart Flow, 2026-11-02).

/** Largest value a Postgres `integer` column holds. */
export const INT4_MAX = 2_147_483_647;

export type QtyValidation = { ok: true; qty: number } | { ok: false; message: string };

/**
 * A whole number 1…INT4_MAX. Accepts a digits-only string (the phone's
 * inputMode="numeric" box arrives as a string; surrounding spaces are
 * trimmed) or an integer number. Blank → "Enter the quantity".
 */
export function validateQty(raw: unknown): QtyValidation {
  let n: number;
  if (raw === undefined || raw === null) return { ok: false, message: "Enter the quantity" };
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s === "") return { ok: false, message: "Enter the quantity" };
    if (!/^[0-9]+$/.test(s)) return { ok: false, message: "Qty must be a whole number" };
    n = Number(s);
  } else if (typeof raw === "number") {
    if (!Number.isInteger(raw)) return { ok: false, message: "Qty must be a whole number" };
    n = raw;
  } else {
    return { ok: false, message: "Qty must be a whole number" };
  }
  if (n <= 0) return { ok: false, message: "Qty must be more than 0" };
  if (n > INT4_MAX) return { ok: false, message: "Qty is too large" };
  return { ok: true, qty: n };
}
