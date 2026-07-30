// Billing "Picking" tab — the wire shapes returned by
// app/api/billing/picking/list/route.ts. Kept beside the WHERE helper so the
// route and its client cannot drift on field names.

export interface BillingDispatchWindow {
  id: number;
  windowTime: string;
  label: string | null;
}

export interface BillingPendingRow {
  id: number;
  obdNumber: string;
  /** shipToOverrideCustomer.customerName ?? shipToCustomerName */
  shipToName: string | null;
  /** True when a Support ship-to override resolved to a real dealer row. */
  shipToOverridden: boolean;
  dispatchTargetDate: string | null;
  dispatchWindow: BillingDispatchWindow | null;
  volume: number | null;
  totalUnitQty: number | null;
  /** pick_assignments.checkedAt — when the supervisor approved the pick. */
  checkedAt: string | null;
  // Raw pass-through, for FLAGS. The route does not interpret these and neither
  // does the table beyond a literal value match — see BILLING_FLAGS below.
  dispatchStatus: string | null;
  orderType: string | null;
  natureOfTransaction: string | null;
}

export interface BillingDoneRow {
  id: number;
  obdNumber: string;
  shipToName: string | null;
  dispatchTargetDate: string | null;
  dispatchWindow: BillingDispatchWindow | null;
  /** Null until the next SAP import fills it — the "awaiting SAP" state. */
  invoiceNo: string | null;
  invoicedAt: string | null;
  invoicedBy: { id: number; name: string } | null;
}

export interface BillingPickingList {
  pending: BillingPendingRow[];
  done: BillingDoneRow[];
}

/**
 * FLAGS shown on a pending row.
 *
 * Both are LITERAL field values, not derived rules — measured against
 * production 2026-07-30: `orderType` ∈ {non_tint, tint} and
 * `natureOfTransaction` ∈ {Sales, null, Stock Transfer}. Nothing is inferred.
 *
 * ⚠ The mockup also shows a CROSS flag. It is NOT implemented, deliberately:
 * cross/local/upcountry is a DELIVERY TYPE, which hangs off the dealer's area
 * (delivery_point_master → area → deliveryType), and the list route does not
 * select it. Adding it means widening the route's select, not guessing here.
 * `dispatchStatus` is deliberately unused: the pending predicate already pins
 * it to 'dispatch', so it carries no information on this screen.
 */
export function billingFlags(row: BillingPendingRow): string[] {
  const flags: string[] = [];
  if (row.orderType === "tint") flags.push("TINT");
  if (row.natureOfTransaction === "Stock Transfer") flags.push("STOCK TFR");
  return flags;
}
