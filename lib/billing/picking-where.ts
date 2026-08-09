import type { Prisma } from "@prisma/client";
import { getHideExclusion } from "@/lib/hide/visibility";
import { getISTDayRange } from "@/lib/dates";

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
export async function buildBillingPendingWhere(
  // OPTIONAL pre-computed hide-exclusion. Omitted → read here, exactly as
  // before. The marker route called this builder AND buildBillingMarkerWhere
  // (which calls it again, plus the invoiced-info arm) = THREE identical
  // obd_visibility_rules reads per poll; the list route made two. Passing one
  // in collapses those to one. Not a cache — still a real read per request.
  hideExclusion?: Prisma.ordersWhereInput,
): Promise<Prisma.ordersWhereInput> {
  // getHideExclusion() is NOT automatic — every query that wants hidden OBDs
  // dropped has to AND-merge it by hand (CORE §7.10). Sequential await, never
  // prisma.$transaction (CORE §3).
  const hide = hideExclusion ?? (await getHideExclusion());

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

/**
 * The INFORMATIONAL half of the Picking tab's Done area: bills the supervisor
 * checked on a given IST day that SAP had ALREADY INVOICED.
 *
 * Why this exists. `buildBillingPendingWhere()` above requires `invoiceNo IS
 * NULL`, and the depot's norm is same-day invoicing — an invoice frequently
 * lands BEFORE the floor finishes checking the bill. Such a bill then failed
 * BOTH lists: Pending excluded it (it has an invoice number) and Done excluded
 * it (nobody stamped `invoicedAt`, so there is no receipt). It vanished from
 * the operator's screen while being perfectly valid in the database. Verified
 * live on OBDs 9108242795 / 9108357546 — both `pick_checked`, dispatch, not
 * hidden, checked 2026-08-02, invoiced 2026-07-25.
 *
 * A checked bill must appear for the day it was CHECKED, always. So this arm
 * buckets on `pick_assignments.checkedAt`, NOT on `dispatchTargetDate` — the
 * same call, for the same reason, that lib/floor/queries.ts:142 makes for its
 * checked band: keying the checked arm on the promise day makes a carried-over
 * bill (due earlier, checked today) fail every arm and disappear at the exact
 * moment it is finished.
 *
 * These rows are INFORMATION ONLY. They are never actionable and never reach a
 * write path: `buildBillingPendingWhere()` is AND-ed into the mark-done
 * `updateMany` (app/api/billing/picking/mark-done/route.ts:96) and carries
 * `invoiceNo: null`, and undo carries its own `invoiceNo: null` guard
 * (app/api/billing/picking/undo/route.ts:85). An already-invoiced row matches
 * neither, however the request is crafted.
 *
 * Read-only. Builds a `where` and nothing else.
 */
export async function buildBillingInvoicedInfoWhere(
  dateStr?: string,
  // OPTIONAL pre-computed hide-exclusion — see buildBillingPendingWhere above.
  hideExclusion?: Prisma.ordersWhereInput,
): Promise<Prisma.ordersWhereInput> {
  // Half-open [start, end) IST window. Omitted dateStr → today, the same
  // default the Done strip has always used (lib/dates.ts). Never hand-roll a
  // day boundary (CORE §3).
  const { start, end } = getISTDayRange(dateStr);

  // Same hand-merge as the pending predicate above — OWNER DECISION: hide
  // applies here too, so a hidden bill stays hidden everywhere. This one await
  // is the only reason this function is async (it stays async either way — the
  // signature is part of the contract both consumers call). Sequential, never
  // prisma.$transaction (CORE §3).
  const hide = hideExclusion ?? (await getHideExclusion());

  return {
    AND: [
      {
        // The SAME stage constant the pending arm uses — never a second
        // hardcoded literal that can drift from it.
        workflowStage: BILLING_PENDING_STAGE,
        // The inversion of the pending arm's `invoiceNo: null`, and the whole
        // point of this helper: SAP has already invoiced this bill.
        invoiceNo: { not: null },
        // 🔴 LOAD-BEARING, NOT TIDY-UP. A bill can be BOTH marked done by the
        // operator AND invoiced by SAP. Without this term such a row would
        // match this arm *and* the Done area's marked-done arm (which keys on
        // `invoicedAt` within the day), rendering twice — a duplicate React
        // key on the same order id, and a doubled count in the Done header.
        // The operator's own receipt wins: a marked row belongs to that arm,
        // and this arm takes only what nobody has marked.
        invoicedAt: null,
        // Soft-delete read (CORE §3).
        isRemoved: false,
        // Bucket by the CHECK date — see the block comment above.
        pickAssignment: { checkedAt: { gte: start, lt: end } },
        // ⚠ dispatchStatus is DELIBERATELY NOT PINNED here, unlike the pending
        // arm — OWNER DECISION: the only thing that removes a checked bill from
        // the day's record is the hide filter, nothing else. A later hold must
        // not retroactively erase the fact that the bill was checked that day.
      },
      hide,
    ],
  };
}

/**
 * What the change-marker aggregates over: the UNION of the two sets the list
 * route renders.
 *
 * 🔒 MARKER ⊇ LIST, NEVER ⊂. A marker watching a WIDER set costs a harmless
 * extra refetch; a NARROWER one means updates that are on screen never refresh.
 * That is not hypothetical here: approving a bill that already carries an
 * invoiceNo touches the pending set not at all — neither its COUNT(*) nor its
 * MAX(updatedAt) moves — so a pending-only marker would never fire, and the
 * informational row would sit unrendered until someone reloaded the page. That
 * is the very failure this whole change exists to remove.
 *
 * `dateStr` scopes ONLY the informational arm; the pending arm is all-dates by
 * design (see the fence note above) and is passed nothing.
 *
 * Sequential awaits, never prisma.$transaction (CORE §3).
 */
export async function buildBillingMarkerWhere(
  dateStr?: string,
  // OPTIONAL pre-computed hide-exclusion, FORWARDED to both arms — see
  // buildBillingPendingWhere above. Omitted, each arm reads its own and this
  // behaves exactly as before.
  hideExclusion?: Prisma.ordersWhereInput,
): Promise<Prisma.ordersWhereInput> {
  const pending = await buildBillingPendingWhere(hideExclusion);
  const invoicedInfo = await buildBillingInvoicedInfoWhere(dateStr, hideExclusion);
  return { OR: [pending, invoicedInfo] };
}
