// lib/paste-clean.ts — clean a number someone PASTED (or typed) before it is
// checked. PURE: no Prisma, no I/O, no clock — safe in a client component and
// in a route, so the screen and the server run the SAME rule on the same text.
//
// Why it exists: values copied out of SAP, Excel or a paper form arrive as
// "1,234.00", "₹1,234.00", "72,881/-", " 9110155831 " or with a trailing tab.
// CI's inputs used to refuse those silently (a grey button, a 0, a truncated
// 12.50 → 12). Each function here returns either the cleaned value or a short
// reason a person can act on — never a guess, never a silent 0.
//
// ⚠ OLDER PRIVATE COPIES, DELIBERATELY NOT MIGRATED IN THIS COMMIT:
// lib/mrn/paste.ts (`parseCount`) and lib/sap-paste/read-paste.ts
// (`parsePasteNumber`) each strip commas in their own module-private way. They
// work and are tested by use; moving them onto this file is a separate change.

export type CleanResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Every kind of space a paste can carry — JS `\s` covers tabs, newlines and
 *  the non-breaking space (U+00A0) Excel and SAP like to emit — plus commas. */
const SPACES_AND_COMMAS = /[\s,]/g;

/** ₹ value: up to 10 integer digits and 2 decimals, matching numeric(12,2).
 *  The regex app/api/ci/[ciId]/close/route.ts has always used, unchanged. */
export const MONEY_RE = /^\d{1,10}(\.\d{1,2})?$/;

/**
 * A rupee amount, KEPT AS A STRING.
 *
 * Strips ₹ / Rs / Rs. / INR (any case), commas, every space and tab, and a
 * trailing "/-" (the paper form writes "72,881/-"), then applies MONEY_RE.
 *
 * 🔴 NEVER parse money through a JS float — binary floating point cannot hold
 * 0.1, and this is a figure on a document someone signs. The caller hands the
 * cleaned string to Prisma.Decimal.
 */
export function cleanMoney(raw: string): CleanResult<string> {
  const s = raw
    .replace(SPACES_AND_COMMAS, "")
    .replace(/₹|inr|rs\.?/gi, "")
    .replace(/\/-$/, "");
  if (s === "") return { ok: false, reason: "Enter the credit value" };
  if (!MONEY_RE.test(s)) {
    return { ok: false, reason: "Credit value: use numbers like 72881.00" };
  }
  return { ok: true, value: s };
}

/**
 * A whole count (tins). Strips commas, spaces and tabs. "12", "12.0" and
 * "12.00" are 12; "12.50" is REFUSED — never truncated, because a truncated
 * count is a wrong figure that looks right. Empty is not ok and is never 0.
 */
export function cleanWholeCount(raw: string): CleanResult<number> {
  const s = raw.replace(SPACES_AND_COMMAS, "");
  if (s === "") return { ok: false, reason: "Enter the number of tins" };
  if (/^\d+\.\d*[1-9]\d*$/.test(s)) {
    return { ok: false, reason: "Tins must be a whole number" };
  }
  if (!/^\d+(\.0*)?$/.test(s)) {
    return { ok: false, reason: "Use numbers only, like 12" };
  }
  const n = Number.parseInt(s, 10);
  if (!Number.isSafeInteger(n)) return { ok: false, reason: "That number is too large" };
  return { ok: true, value: n };
}

/**
 * A document number made of digits (SAP's CI number). Strips spaces, tabs,
 * commas and a trailing ".0…" that Excel adds to a number cell, then requires
 * digits only.
 *
 * 🔴 LEADING ZEROS ARE KEPT. "0045123" stays "0045123" — the padding is part
 * of the identifier (CLAUDE_CI.md §13, the digitsCell note after CI-16).
 */
export function cleanDigitId(raw: string): CleanResult<string> {
  const s = raw.replace(SPACES_AND_COMMAS, "").replace(/\.0+$/, "");
  if (s === "") return { ok: false, reason: "Enter SAP's CI number" };
  if (!/^\d+$/.test(s)) {
    return { ok: false, reason: "CI number: digits only, like 85832091" };
  }
  return { ok: true, value: s };
}
