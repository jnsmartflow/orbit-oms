// lib/ci/search-term.ts — CI's invoice / OBD search-term rule. PURE.
//
// Moved VERBATIM out of lib/ci/queries.ts (2026-10-10) so a pure caller can use
// the ONE rule without importing Prisma: lib/order-invoices/rules.ts
// (normaliseInvoiceNo, Add invoices) reuses it rather than writing a second
// one. lib/ci/queries.ts imports it back and re-exports normaliseCiSearchTerm,
// so every existing import keeps working. Behaviour unchanged.

export const BARE_INVOICE_DIGITS = /^\d{9}$/;

/** The last-4 shortcut: exactly four digits and nothing else. */
export const LAST_FOUR_DIGITS = /^\d{4}$/;

/**
 * Normalise what the supervisor typed into what we query.
 *
 * Measured over all 6,950 live invoice numbers (2026-08-31): EVERY one is `I`
 * plus 9 digits, length 10, uppercase, no spaces, no padding — a single shape
 * with zero exceptions. So normalising is `trim().toUpperCase()` and nothing
 * more elaborate.
 *
 * ⚠ THE BARE-9-DIGITS RULE IS DELIBERATE (spec §4). A supervisor reading a
 * paper invoice will type the digits and leave the `I` off; without this he
 * gets an empty result for a number he read correctly, which looks like a
 * broken search rather than a typo. 9 digits is unambiguous — an OBD number is
 * 10 — so the two cannot collide.
 *
 * Returns the term to match against BOTH `invoiceNo` and `obdNumber`; the caller
 * does not need to know which one it will hit.
 *
 * ⚠ FOUR DIGITS ARE LEFT ALONE. The last-4 shortcut is a SUFFIX, not a whole
 * number, so it must not be prefixed with `I` — `I2577` is not the start of
 * anything. searchCiBills (lib/ci/queries.ts) decides what to do with it; this function's job
 * is only to canonicalise a WHOLE term.
 */
export function normaliseCiSearchTerm(raw: string): string {
  const q = raw.trim().toUpperCase();
  if (LAST_FOUR_DIGITS.test(q)) return q;
  return BARE_INVOICE_DIGITS.test(q) ? `I${q}` : q;
}
