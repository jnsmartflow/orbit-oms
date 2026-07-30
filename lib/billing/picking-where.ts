import type { Prisma } from "@prisma/client";
import { getHideExclusion } from "@/lib/hide/visibility";

/**
 * The workflowStage a bill sits at once the supervisor has approved the pick
 * (`pick_assignments.checkedAt` stamped). This is where Billing picks it up.
 * Never the historical 'closed' union — see lib/workflow-stages.ts.
 */
export const BILLING_PENDING_STAGE = "pick_checked";

/**
 * THE single definition of a "pending to invoice" bill for the Billing Picking
 * tab. Both consumers import THIS — the list route
 * (app/api/billing/picking/list/route.ts) and the change-marker
 * (app/api/billing/picking/marker/route.ts) — so the marker can never watch a
 * narrower set than the list renders. A marker scoped tighter than its list
 * silently stops refreshing rows that ARE on screen.
 *
 * Pattern borrowed from lib/picking/queue.ts's buildPickingWhere() (one shared
 * predicate, two callers) — but the predicate itself is deliberately NOT
 * buildPickingWhere's, see the fence note below.
 *
 * ⛔ NO dispatchTargetDate FENCE — DO NOT ADD ONE. ⛔
 * Picking fences its checked band to IST TODAY: buildPickingWhere()'s
 * 'openPending' arm carries `{ workflowStage: PICK_CHECKED,
 * dispatchTargetDate: todayDateOnly }` (lib/picking/queue.ts, "only the Checked
 * band stays on today"). That is right for the picking FLOOR, which only cares
 * about today's work — and WRONG for Billing.
 *
 * Billing is ALL DATES on purpose: a bill checked YESTERDAY and still
 * uninvoiced MUST still appear today, or it falls off the board and nobody
 * invoices it. Carry-over is the normal case here, not an edge case. The list
 * is bounded by `invoiceNo IS NULL AND invoicedAt IS NULL` — the WORK being
 * outstanding — never by a calendar day.
 *
 * This is also exactly why this helper does not call buildPickingWhere() and
 * does not reuse the 'openPending' scope: that scope is NARROWER than what
 * Billing needs, and reusing it would look like sharing while quietly dropping
 * every carry-over bill. Only the Done strip is day-scoped (see the list
 * route), because "what did we invoice today" IS a per-day question.
 *
 * Read-only. Builds a `where` and nothing else — no writes anywhere in this
 * module.
 */
export async function buildBillingPendingWhere(): Promise<Prisma.ordersWhereInput> {
  // getHideExclusion() is NOT automatic — every query that wants hidden OBDs
  // dropped has to AND-merge it by hand (CORE §7.10). Sequential await, never
  // prisma.$transaction (CORE §3).
  const hide = await getHideExclusion();

  // Merged as a SIBLING member of the top-level AND — the same shape
  // lib/floor/queries.ts:154 uses. Never nested inside the base object: hide
  // returns its own `{ AND: [...] }` when rules are active, and folding that
  // into a sibling key would collide with this predicate's own AND.
  return {
    AND: [
      {
        workflowStage: BILLING_PENDING_STAGE,
        // Not yet invoiced in SAP…
        invoiceNo: null,
        // …and not yet marked done by a billing operator. Clearing invoicedAt
        // (Undo) returns the bill to this list — which is why the marker keys
        // on the same predicate.
        invoicedAt: null,
        // Soft-delete read (CORE §3).
        isRemoved: false,
        dispatchStatus: "dispatch",
      },
      hide,
    ],
  };
}
