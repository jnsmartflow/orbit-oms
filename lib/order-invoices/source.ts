// lib/order-invoices/source.ts — THE order_invoices."source" VOCABULARY
// (Split load phase 2, 2026-10-24, Schema v27.76). PURE.
//
// The CHECK chk_order_invoices_source allows exactly these three (v27.76):
//   · 'sap'    — seq 1, SAP's invoice, mirrored from orders (sap-row.ts)
//   · 'manual' — seq 2..n typed by hand in Add invoices (split.ts)
//   · 'load'   — a truck PART of one invoice (Split load, load-split.ts):
//                "loadParentId" names its group's root, on the same OBD
// A status string is not an enum (CORE §3): new code names a source through
// this constant, never a retyped literal.

export const INVOICE_SOURCE = {
  SAP: "sap",
  MANUAL: "manual",
  LOAD: "load",
} as const;

export type InvoiceSource = (typeof INVOICE_SOURCE)[keyof typeof INVOICE_SOURCE];
