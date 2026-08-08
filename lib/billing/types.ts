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
  /**
   * TRUE when at least one line on this bill carries a pick_findings row that a
   * supervisor has CONFIRMED.
   *
   * ⚠ "Confirmed" means `pick_findings.recordedById IS NOT NULL` and NOTHING
   * ELSE — the same discriminator `findingState()` uses
   * (components/picking/finding-recorder.tsx:45-48, doctrine in
   * lib/picking/types.ts:136-140). Never inferred from `qtyFound` or `reason`: a
   * supervisor may legitimately confirm a line at the full ordered quantity, and
   * a PENDING finding (picker reported, nobody signed off) is a claim, not a
   * fact, so it deliberately does NOT light this flag.
   *
   * Boolean, not a count — Billing acts per BILL, not per line. How MANY lines
   * are short is a question for a detail surface that does not exist yet.
   *
   * PENDING ROWS ONLY. `BillingDoneRow` deliberately has no equivalent: the Done
   * area is a record of what already happened and nobody works those rows.
   */
  hasConfirmedShortage: boolean;
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
  /**
   * WHICH of the Done area's two arms this row came from.
   *
   *   "marked"   — the billing operator marked it done that day (invoicedAt in
   *                the window). ACTIONABLE history: it may still carry Undo.
   *   "invoiced" — checked that day, and SAP had ALREADY invoiced it. PURELY
   *                INFORMATIONAL: never selectable, never copied, never marked
   *                done, never undone. It exists because such a bill used to
   *                match neither list and vanished from the screen entirely.
   *
   * ⚠ An EXPLICIT discriminator, deliberately not inferred from
   * `invoicedAt === null` — a "marked" row whose SAP invoice has not landed yet
   * has a null `invoiceNo` and reads confusingly similar. The server knows
   * which query produced the row; the client must not re-derive it.
   */
  kind: "marked" | "invoiced";
  /** pick_assignments.checkedAt — when the supervisor approved the pick.
   *  Populated on "invoiced" rows only; null on "marked" rows. */
  checkedAt: string | null;
  /** pick_assignments.checkedBy.name — who approved it. "invoiced" rows only.
   *  This is the name the UI shows in place of `invoicedBy` on those rows: no
   *  billing operator acted on them, so there is no invoicedBy to show. */
  checkedByName: string | null;
  /**
   * The ONE key the merged Done list sorts on, newest first — computed
   * server-side as `invoicedAt ?? checkedAt` so the two arms cannot be ordered
   * by two different clocks, and so the client never re-derives an ordering
   * the route did not intend.
   */
  sortAt: string | null;
}

export interface BillingPickingList {
  pending: BillingPendingRow[];
  done: BillingDoneRow[];
}

// ── Detail panel — GET /api/billing/picking/order/[orderId] ─────────────────
// Billing's OWN read-only view of one bill's lines. Deliberately not Floor's
// FloorDetail: that payload carries ship-to/slot/activity/override facts this
// panel has no controls for, and its route gates on `floor`/canView, which the
// billing operators do not hold.

/**
 * A CONFIRMED pick_findings row on one line, or null.
 *
 * ⚠ CONFIRMED ONLY. The route filters `recordedById: { not: null }`, so a
 * PENDING finding — the picker reported it, no supervisor has signed off —
 * never reaches this type. That is the same test
 * `BillingPendingRow.hasConfirmedShortage` applies, and it must stay that way:
 * if the two ever diverge, a row could carry the ⚠ flag and open onto a panel
 * showing no flagged line (or the reverse), and the operator would have no way
 * to tell which surface was lying.
 *
 * There is therefore no `recordedById` here — it would always be non-null, and
 * carrying it would invite a consumer to re-derive a state this payload has
 * already decided.
 */
export interface BillingDetailLineFinding {
  qtyFound: number;
  /** Raw DB value ('short_quantity' | 'old_mfg'); label via findingReasonLabel(). */
  reason: string;
  recordedAt: string | null;
  /** users.name of the supervisor who confirmed it. */
  recordedByName: string | null;
}

export interface BillingDetailLine {
  /** import_raw_line_items.id — the pick_findings FK target. */
  id: number;
  sku: string;
  /** sku_master_v2.description, else the raw SAP text, else null. */
  name: string | null;
  /** Pack CODE only ("1L", "500ML"). Blank stays blank, never guessed. */
  pack: string | null;
  /** Qty ORDERED on this line (import_raw_line_items.unitQty). */
  qty: number;
  litres: number;
  isTint: boolean;
  finding: BillingDetailLineFinding | null;
}

export interface BillingOrderDetail {
  orderId: number;
  obdNumber: string;
  obdDateTime: string | null;
  customerName: string | null;
  customerCode: string | null;
  /** True when a Support/Billing ship-to override resolved to a real dealer row
   *  — the panel labels the name so it is not mistaken for the SAP bill-to. */
  isShipToOverride: boolean;
  lines: BillingDetailLine[];
  lineCount: number;
  totalLitres: number;
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
