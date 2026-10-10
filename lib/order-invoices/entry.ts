// lib/order-invoices/entry.ts — ADD INVOICES, the modal's arithmetic. PURE: no
// Prisma, no React — safe in the browser. Tests: lib/order-invoices/entry.test.ts
// (npx tsx --test lib/order-invoices/entry.test.ts).
//
// The SAVE rules are rules.ts (validateSplit), shared with the server; this file
// only helps a person type papers in (docs/mockups/add-invoices/add-invoices-flow.html).

import { INVOICE_NO_SHAPE, normaliseInvoiceNo } from "./rules";

/**
 * What a person typed for a paper's invoice number → the full `I` + 9-digit
 * number, or "" when it cannot be one yet.
 *
 *   "I536230713" / "i536230713" / "536230713" → "I536230713"   (CI's rule)
 *   "713" with SAP "I536230716"               → "I536230713"   (SAP's leading digits fill the rest)
 *
 * The papers of one OBD are numbered together, so their first digits match
 * SAP's — the mockup's `full()`. Only the FULL form is ever sent to the API.
 */
export function expandInvoiceNo(raw: string, sapInvoiceNo: string | null): string {
  const n = normaliseInvoiceNo(raw);
  if (INVOICE_NO_SHAPE.test(n)) return n;
  const digits = n.replace(/^I/, "");
  if (!/^\d{1,8}$/.test(digits)) return "";
  if (sapInvoiceNo === null || !INVOICE_NO_SHAPE.test(sapInvoiceNo)) return "";
  const sapDigits = sapInvoiceNo.slice(1);
  return `I${sapDigits.slice(0, 9 - digits.length)}${digits}`;
}

/**
 * ~kg of one invoice: the OBD's header kg shared by litres (CORE §7.3 v27.63 —
 * kg per invoice is DERIVED, never stored; most lines carry no kg of their own).
 * null when it cannot be told: no OBD kg, or no litres to share by.
 */
export function kgShare(obdKg: number | null, invoiceLitres: number, obdLitres: number): number | null {
  if (obdKg === null || !(obdKg > 0)) return null;
  if (!(obdLitres > 0)) return null;
  return (obdKg * invoiceLitres) / obdLitres;
}

/** The litres of `qty` tins of a line: SAP's line litres pro rata. */
export function lineLitres(volumeLine: number | null, unitQty: number, qty: number): number {
  if (volumeLine === null || unitQty <= 0) return 0;
  return (volumeLine * qty) / unitQty;
}

/** Tins of each line still to place: unitQty minus every SAVED paper's tins. */
export function tinsLeft(unitQtys: number[], savedPapers: number[][]): number[] {
  return unitQtys.map((u, i) => u - savedPapers.reduce((s, p) => s + (p[i] ?? 0), 0));
}
