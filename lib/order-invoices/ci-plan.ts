// lib/order-invoices/ci-plan.ts — A CI PER INVOICE (Add invoices 6.3,
// 2026-10-19). PURE: no Prisma, no React, no clock. Tests:
// lib/order-invoices/ci-plan.test.ts (npx tsx --test lib/order-invoices/ci-plan.test.ts).
//
// On a SPLIT OBD, Floor's Raise CI can return ONE INVOICE (one CI per ticked
// invoice row): ci_returns."orderInvoiceId" = that row, its lines = that
// invoice's order_invoice_lines (raw line + tins) — never the whole bill. The
// OBD is NOT cancelled (Cancel stays per OBD); the invoice is finished, and
// leaves To plan / On hold for the Cancel & CI tab.
//
// WHICH CI COVERS AN INVOICE ROW. A CI with "orderInvoiceId" NULL on a split
// OBD is WHOLE-OBD (every raiser before 6.3, lib/order-invoices/links.ts), so it
// covers every row; a per-invoice CI covers its own row only. Unsplit OBDs never
// come here — their seq-1 CI is the whole bill, as always.

/** One invoice row of the split OBD, as the plan needs it. */
export interface CiInvoiceRow {
  id: number;
  seq: number;
  invoiceNo: string | null;
  tripDropId: number | null;
  tripNumber: string | null;
  isDispatched: boolean;
  /** order_invoice_lines: the raw line and the tins on this invoice. */
  lines: ReadonlyArray<{ rawLineItemId: number; qty: number }>;
  /** Split load — the row is in a load group (a truck part or a root with
   *  parts; loadGroupsOf n > 1). Omitted = not. */
  inLoadGroup?: boolean;
}

/** A non-voided CI of the OBD (draft included). */
export interface OrderCi {
  id: number;
  ciNumber: string | null;
  status: string;
  orderInvoiceId: number | null;
}

/** "I536230713" — or "Invoice 2" before SAP stamps a number. */
export function ciInvoiceLabel(r: Pick<CiInvoiceRow, "seq" | "invoiceNo">): string {
  return r.invoiceNo ?? `Invoice ${r.seq}`;
}

/** Does this CI cover that invoice row? NULL = whole OBD = every row. */
export function ciCoversRow(ci: Pick<OrderCi, "orderInvoiceId">, rowId: number): boolean {
  return ci.orderInvoiceId === null || ci.orderInvoiceId === rowId;
}

/** Owner decision 2026-10-26: NO CI on a single truck part (it would be written
 *  FULL holding only part of the tins). A return on a split bill is raised as a
 *  WHOLE-BILL CI from the CI page by choosing the SKUs. Was LOAD_CI_LATER
 *  ("…comes in the next update") until the CI-on-a-part batch was dropped. */
export const SPLIT_BILL_CI_PAGE = "Split bill — raise CI from the CI page and choose the SKUs.";

/**
 * On a trip / dispatched → refused, in the bottom bar's words. A HELD invoice is
 * allowed. A row in a LOAD GROUP is refused first (SPLIT_BILL_CI_PAGE — the
 * same words the Floor button shows).
 */
export function invoiceCiRefusal(r: CiInvoiceRow): string | null {
  if (r.inLoadGroup === true) return SPLIT_BILL_CI_PAGE;
  if (r.isDispatched) return `${ciInvoiceLabel(r)} is dispatched — it cannot be returned here`;
  if (r.tripDropId !== null) return `${ciInvoiceLabel(r)} is on ${r.tripNumber ?? "a trip"} — remove it from the trip first`;
  return null;
}

/**
 * The duplicate guard, per (orderId, orderInvoiceId). A live CI (not a draft)
 * covering the row → "Already has CI-…" (a second one would double the credit
 * in SAP); a draft covering it → open on /ci. null = may be raised.
 */
export function invoiceCiDuplicate(cis: readonly OrderCi[], rowId: number): string | null {
  const live = cis.find((c) => c.status !== "draft" && ciCoversRow(c, rowId));
  if (live) return `Already has ${live.ciNumber ?? `CI #${live.id}`}`;
  if (cis.some((c) => c.status === "draft" && ciCoversRow(c, rowId))) return "A CI draft is open on /ci for this bill";
  return null;
}

/** One ACTIVE raw line of the OBD (lib/ci/full-bill.ts ActiveBillLine). */
export interface CiActiveLine {
  id: number;
  skuCodeRaw: string | null;
  unitQty: number | null;
  volumeLine: number | null;
}

export type InvoiceCiPicks<L extends CiActiveLine> =
  | { ok: true; picks: Array<{ src: L; returnedQty: number }> }
  | { ok: false; reason: string };

/**
 * The invoice's lines as CI picks: each raw line on the invoice at the tins
 * the invoice carries, in BILL order (the active lines' order). Refused when
 * the invoice has no lines, a line is no longer active in SAP, or a line's
 * tins are under 1 — the split must be re-checked first, never a CI that
 * quietly drops a line.
 */
export function invoiceCiPicks<L extends CiActiveLine>(
  row: Pick<CiInvoiceRow, "seq" | "invoiceNo" | "lines">,
  active: readonly L[],
): InvoiceCiPicks<L> {
  if (row.lines.length === 0) return { ok: false, reason: `${ciInvoiceLabel(row)} has no lines — re-check invoices` };
  const qty = new Map<number, number>();
  for (const l of row.lines) qty.set(l.rawLineItemId, (qty.get(l.rawLineItemId) ?? 0) + l.qty);
  const byId = new Map(active.map((a) => [a.id, a]));
  const gone = Array.from(qty.keys()).filter((id) => !byId.has(id));
  if (gone.length > 0) return { ok: false, reason: `Lines changed in SAP — re-check invoices before returning ${ciInvoiceLabel(row)}` };
  const zero = Array.from(qty.entries()).filter(([, q]) => q < 1);
  if (zero.length > 0) return { ok: false, reason: `${ciInvoiceLabel(row)} has a line with no tins — re-check invoices` };
  return { ok: true, picks: active.filter((a) => qty.has(a.id)).map((src) => ({ src, returnedQty: qty.get(src.id)! })) };
}
