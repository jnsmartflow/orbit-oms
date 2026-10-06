// lib/challan-orders/orb-number.ts
//
// THE ORB NUMBER — a challan order's own number, `ORB-{YYYY}-{NNNNN}`, held in
// orders.obdNumber (Challan orders, Schema v27.60; design
// docs/prompts/drafts/web-update-2026-10-06-challan-orders.md F6).
//
// ONE owner for the shape. The database enforces the same pattern
// (chk_orders_orb_number: an ORB order MUST match it, any other bill must NOT
// start 'ORB-'), so this is the code twin of a live CHECK, not a guess.
//
// ⚠ NOT an Orbit CUSTOMER code. delivery_point_master also uses 'ORB-'
// (`ORB-00001`, v27.57) — no year, five digits. This pattern cannot match one.
//
// Pure: no imports, safe in client and server code alike.

/** Exactly `ORB-` + four-digit year + `-` + five digits, upper case. */
export const ORB_NUMBER_RE = /^ORB-\d{4}-\d{5}$/;

/** Is this (already trimmed and upper-cased) string an ORB number? */
export function isOrbNumber(q: string): boolean {
  return ORB_NUMBER_RE.test(q);
}
