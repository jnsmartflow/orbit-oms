// lib/customers/orbit-code.ts — Orbit customers (2026-10-05).
//
// An "Orbit customer" is a delivery_point_master row that is NOT in SAP — a
// transporter hub, a godown — used only as a SHIP-TO. Its code is made by the
// SYSTEM, never typed: 'ORB-' + nextval('orb_customer_code_seq') zero-padded to
// five digits (ORB-00001, ORB-00002 …). Gaps are acceptable (a failed create
// burns a number).
//
// Rules held elsewhere, each with its own guard:
//   - created only by POST /api/admin/customers with orbitOnly:true, and only by
//     a superuser (server-enforced);
//   - nobody may TYPE an ORB- code (admin POST/PATCH, CSV import, Tint Add
//     ship-to, the mail-order customer picker all refuse it);
//   - an ORB customer NEVER gets a mo_customer_keywords row — that is what keeps
//     it out of every bill-to picker (/po, /po2, /place-order, mail-order match).

export const ORB_PREFIX = "ORB-";

/** True when the code is (or claims to be) an Orbit code — case-insensitive. */
export function isOrbCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return code.trim().toUpperCase().startsWith(ORB_PREFIX);
}

/** nextval → "ORB-00001". */
export function formatOrbCode(n: number): string {
  return `${ORB_PREFIX}${String(n).padStart(5, "0")}`;
}

/** Duplicate-check key: lower-case, trimmed, runs of whitespace collapsed. */
export function normaliseName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export const ORB_TYPED_REFUSAL =
  "Codes starting with ORB- are made by the system for Orbit customers and cannot be typed.";
