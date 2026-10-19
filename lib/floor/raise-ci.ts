// lib/floor/raise-ci.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 ONE OWNER FOR "RAISE A FULL-BILL CI AND TAKE THE BILL OFF" — per bill
// ═══════════════════════════════════════════════════════════════════════════
//
// Extracted VERBATIM from app/api/floor/ci/route.ts (2026-10-01, Tint Manager
// tabs build step 3 — docs/prompts/drafts/code-discovery-2026-10-01-tint-manager-build-plan.md §C).
// Floor's route keeps its gate, its body validation and its loop; the per-bill
// body lives here so the Tint Manager's route (app/api/tint/manager/ci) runs the
// SAME refusals, the SAME CI shape and the SAME three cancel writes.
//
// The only two things a caller chooses:
//   - allowTintRoom — lifts offFloorRefusal's tint-room refusal. ONLY the Tint
//     Manager passes it, and only together with…
//   - beforeWrite — awaited once every pre-check has passed, right before the
//     first write (the CI create, or step f on a retry). The Tint Manager passes
//     lib/tint/stop-work.ts stopTintWork here, so a bill that is SKIPPED (a
//     duplicate CI, an open draft, lines with no delivered qty) never has its
//     operator's job stopped for nothing. Floor passes nothing.
//
// ── What each CI is (fixed, owner) ─────────────────────────────────────────
//   one CI per bill · returnType 'full' (every active line at its delivered
//   quantity — lib/ci/full-bill.ts, the SAME rows a manual 'full' CI stores) ·
//   materialMoved 'not_moved' ("goods in depot") · materialReceivedDate = IST
//   today · status 'submitted' (straight onto billing's desk) · source 'floor'
//   · reason = one active ci_reason_master row, label snapshotted · remark →
//   reasonRemark · supervisorId = the desk user who pressed it.
//   🔴 A missing invoiceNo NEVER blocks (CLAUDE_CI §5): it snapshots as null
//   and every read path shows the live order value once SAP sends it.
//   ⚠ source stays 'floor' for a Tint Manager CI too — the CHECK on
//   ci_returns.source allows a fixed list (CLAUDE_CI §3) and this build makes no
//   schema change. The supervisorId names who pressed it.
//
// ── Per bill, in this order ─────────────────────────────────────────────────
//   a. the order (not removed)
//   b. offFloorRefusal — cancelled / dispatched / on a trip / in the tint room
//      (the last lifted by allowTintRoom)
//   c. duplicate guard — ANY live (non-voided, non-draft) CI, ANY source:
//        a 'floor' CI on a bill still on the floor → a previous press created
//        the CI and then failed to take the bill off: skip the create, finish
//        (f). That is what makes a retry safe.
//        anything else → skipped "Already has CI-…".
//      an open draft on /ci → skipped: two people would be returning one bill.
//   d. the full-bill lines; a bill that cannot be returned in full is skipped
//   (beforeWrite)
//   e. ONE nested create at 'submitted' — auto.ts / bill-only.ts's form:
//      allocate the number, create header + lines, re-allocate ONCE on P2002
//   f. ONE orders.update {cancelled, dispatchStatus null} → pick_assignments
//      cleared → ONE order_status_logs row "CI raised — {ciNumber} · {reason}"
//      — the same three writes, in the same order, as the floor cancel.
//
// Sequential awaits, never prisma.$transaction (CORE §3). Server-only.
//
// NOT copied from lib/ci/auto.ts, on purpose: its invoice fire rule, the
// pick_findings read, the due-lines / old-MFG rule, its (orderId + source)
// find-or-create, freeze/delete, reason-by-code, returnType 'part', and the
// line reconcile. Those are the findings path's, not this one's.

import { Prisma } from "@prisma/client";
import { challanCancelRefusal, releaseChallanOnCancel } from "@/lib/challan-orders/cancel-guard";
import { prisma } from "@/lib/prisma";
import { allocateCiNumber } from "@/lib/ci/number";
import { ciPartyColumns, resolveCiDealer } from "@/lib/ci/derive";
import { loadBillToByObd } from "@/lib/reports/bill-facts";
import { linkRowForOrder } from "@/lib/order-invoices/links";
import { computeFullBillLines, deriveCiLineRows, readActiveBillLines } from "@/lib/ci/full-bill";
import { ciInvoiceLabel, invoiceCiDuplicate, invoiceCiPicks, invoiceCiRefusal } from "@/lib/order-invoices/ci-plan";
import { offFloorRefusal } from "@/lib/floor/off-floor";
import { INVOICE_TRIPS_SELECT, invoiceTripsOf } from "@/lib/order-invoices/trip-refusal";
import { mirrorObdHoldSafe } from "@/lib/order-invoices/hold";
import { settleObdDone } from "@/lib/order-invoices/dispatch";

export interface CiReasonOption {
  id: number;
  label: string;
  isPinned: boolean;
  sortOrder: number;
}

/** ACTIVE ci_reason_master rows, pinned first, then sortOrder, then id. The
 *  list is DATA (CLAUDE_CI §3) — never hardcoded on a client. */
export async function listActiveCiReasons(): Promise<CiReasonOption[]> {
  return prisma.ci_reason_master.findMany({
    where: { isActive: true },
    orderBy: [{ isPinned: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, label: true, isPinned: true, sortOrder: true },
  });
}

/** One ACTIVE reason by id, or null. The label is snapshotted from this row. */
export async function findActiveCiReason(reasonId: number): Promise<{ id: number; label: string } | null> {
  return prisma.ci_reason_master.findFirst({
    where: { id: reasonId, isActive: true },
    select: { id: true, label: true },
  });
}

export type RaiseCiResult =
  | { ok: true; orderId: number; obdNumber: string; ciNumber: string }
  | { ok: false; orderId: number; obdNumber: string | null; reason: string };

/**
 * Raise ONE full-bill CI and take the bill off (steps a–f above). Never throws:
 * every failure comes back as `{ ok: false, reason }` with Floor's wording —
 * including the "{ciNumber} was raised but the bill could not be taken off"
 * case, which a retry finishes.
 */
export async function raiseFullBillCi(args: {
  orderId: number;
  reason: { id: number; label: string };
  remark: string | null;
  userId: number;
  allowTintRoom?: boolean;
  beforeWrite?: () => Promise<void>;
  /** Is the presser admin (lib/rbac.ts isSuperuser)? A challan (ORB) order is
   *  admin-only (S5-4, 2026-10-07). Omitted = false — fail closed for ORB rows only. */
  actorIsAdmin?: boolean;
}): Promise<RaiseCiResult> {
  const { orderId, reason, remark, userId } = args;
  let obdNumber: string | null = null;
  // Set once a CI exists for this bill (created now, or by an earlier press),
  // so a failure in (f) can say so rather than read as "no CI".
  let ciNumber: string | null = null;
  try {
    // ── a. The order ──────────────────────────────────────────────────────
    // The header snapshot fields are bill-only.ts's select (itself the
    // confirm route's), so a floor CI names the same dealer a manual one
    // would (resolveCiDealer — CLAUDE_CI §13 CI-5).
    const order = await prisma.orders.findFirst({
      where: { id: orderId, isRemoved: false },
      select: {
        id: true,
        obdNumber: true,
        invoiceNo: true,
        invoiceDate: true,
        customerId: true,
        shipToCustomerId: true,
        shipToCustomerName: true,
        shipToOverrideCustomer: { select: { customerName: true } },
        customer: { select: { customerName: true } },
        soNumber: true,
        workflowStage: true,
        // S5-3 / S5-4 (2026-10-07) — lib/challan-orders/cancel-guard.ts.
        isChallanOrder: true,
        tripDropId: true,
        tripDrop: { select: { trip: { select: { tripNumber: true } } } },
        // Each invoice row's trip — the partly-on-a-trip message (Phase 5 commit 2).
        invoices: INVOICE_TRIPS_SELECT,
      },
    });
    if (order === null) {
      return { ok: false, orderId, obdNumber: null, reason: "Order not found" };
    }
    obdNumber = order.obdNumber;

    // ── b0. A challan (ORB) order: admin only (S5-4) ─────────────────────
    const challanRefusal = challanCancelRefusal(order.isChallanOrder, args.actorIsAdmin === true);
    if (challanRefusal !== null) {
      return { ok: false, orderId, obdNumber, reason: challanRefusal };
    }

    // ── b. Refusals — the same ones the floor cancel applies ──────────────
    const refusal = offFloorRefusal(
      {
        workflowStage: order.workflowStage,
        tripDropId: order.tripDropId,
        tripNumber: order.tripDrop?.trip.tripNumber ?? null,
        invoiceTrips: invoiceTripsOf(order.invoices),
      },
      { allowTintRoom: args.allowTintRoom === true },
    );
    if (refusal !== null) {
      return { ok: false, orderId, obdNumber, reason: refusal };
    }

    // ── c. Duplicate guard — ANY live CI, ANY source ──────────────────────
    // A second CI on a bill would double the credit in SAP, whoever raised
    // the first (the same rule lib/ci/bill-only.ts applies).
    const existing = await prisma.ci_returns.findFirst({
      where: { orderId, isVoided: false, status: { not: "draft" } },
      orderBy: { id: "asc" },
      select: { id: true, ciNumber: true, source: true, reasonLabel: true },
    });
    let noteReasonLabel = reason.label;
    if (existing !== null) {
      // The bill passed (b), so it is NOT cancelled yet. A floor CI on it
      // means an earlier press created the CI and then failed at (f) —
      // finish that press rather than refuse it. The note names that CI's
      // own reason, which is the one billing sees.
      if (existing.source === "floor" && existing.ciNumber !== null) {
        ciNumber = existing.ciNumber;
        noteReasonLabel = existing.reasonLabel ?? reason.label;
        if (args.beforeWrite) await args.beforeWrite();
      } else {
        return {
          ok: false,
          orderId,
          obdNumber,
          reason: `Already has ${existing.ciNumber ?? `CI #${existing.id}`}`,
        };
      }
    } else {
      const draft = await prisma.ci_returns.findFirst({
        where: { orderId, isVoided: false, status: "draft" },
        select: { id: true },
      });
      if (draft !== null) {
        return { ok: false, orderId, obdNumber, reason: "A CI draft is open on /ci for this bill" };
      }

      // ── d. Every active line at its delivered quantity ──────────────────
      const full = await computeFullBillLines(order.obdNumber);
      if (!full.ok) {
        return {
          ok: false,
          orderId,
          obdNumber,
          reason:
            full.reason === "no_lines"
              ? "The bill has no active lines to return"
              : `${full.lineIds.length} line(s) have no delivered quantity, so it cannot be returned in full — use Part on /ci`,
        };
      }

      // Every pre-check passed — the caller's last word before anything is
      // written (the Tint Manager stops the operator's job here).
      if (args.beforeWrite) await args.beforeWrite();

      // ── e. ONE nested create at 'submitted' ─────────────────────────────
      // ONE clock: it stamps submittedAt and picks the year's sequence.
      const now = new Date();
      // Today in IST, stored as UTC-midnight of the IST calendar day — never
      // toISOString().slice(0,10), which is yesterday after 18:30 IST.
      const istDay = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      const materialReceivedDate = new Date(`${istDay}T00:00:00Z`);

      // Number first; UNIQUE(ciNumber) is the backstop, so a P2002
      // re-allocates ONCE (CLAUDE_CI §13 CI-4). No loop, no transaction.
      // Which invoice row came back (v27.66, lib/order-invoices/links.ts): seq 1
      // on an unsplit bill; NULL on a split one until Phase 6 assigns it from lines.
      const orderInvoiceId = await linkRowForOrder(order.id, "ci");
      // The bill-to, newest raw summary row for this OBD (one shared reader).
      const billTo = (await loadBillToByObd([order.obdNumber])).get(order.obdNumber);
      const MAX_ATTEMPTS = 2;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && ciNumber === null; attempt += 1) {
        const identity = await allocateCiNumber(now);
        try {
          const created = await prisma.ci_returns.create({
            data: {
              orderId: order.id,
              orderInvoiceId,
              obdNumber: order.obdNumber,
              // May be null — never blocks (CLAUDE_CI §5, §13 CI-1).
              invoiceNo: order.invoiceNo,
              invoiceDate: order.invoiceDate,
              soNumber: order.soNumber,
              customerId: order.customerId,
              customerCode: order.shipToCustomerId,
              customerName: resolveCiDealer(order),
              // 2026-10-17 owner ruling: CI DISPLAYS bill-to + SAP ship-to (new columns). customerName still snapshots the effective dealer for history — do not switch display back to it.
              ...ciPartyColumns(billTo, order),
              returnType: "full",
              // The four chk_ci_returns_complete_when_not_draft needs past
              // draft — all set.
              materialMoved: "not_moved",
              materialReceivedDate,
              reasonId: reason.id,
              reasonLabel: reason.label,
              reasonRemark: remark,
              supervisorId: userId,
              ciNumber: identity.ciNumber,
              status: "submitted",
              submittedAt: now,
              source: "floor",
              lines: { create: full.lines },
            },
            select: { ciNumber: true },
          });
          ciNumber = created.ciNumber ?? identity.ciNumber;
        } catch (err) {
          const collided = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
          if (collided && attempt < MAX_ATTEMPTS) continue;
          throw err;
        }
      }
      if (ciNumber === null) {
        return { ok: false, orderId, obdNumber, reason: "Could not allocate a CI number — try again" };
      }
    }

    // ── f. Off the floor — the floor cancel's three writes ────────────────
    // ONE orders.update per bill (the live-sync markers key on
    // MAX(orders.updatedAt) — CORE §3). This is also what the floor marker
    // sees: a write to ci_returns alone would not move it.
    await prisma.orders.update({
      where: { id: orderId },
      data: { workflowStage: "cancelled", dispatchStatus: null },
    });
    // 6.1 — a cancel clears every invoice row's hold (lib/order-invoices/hold.ts; never throws).
    await mirrorObdHoldSafe(orderId, false);
    // AFTER the stage write, never before — the ordering and the reason are
    // the floor cancel's (lib/floor/bill-actions.ts, the orphan fix).
    await prisma.pick_assignments.deleteMany({ where: { orderId } });
    // S5-3 + S6-4 — a cancelled ORB order frees its SOs and returns its linked bills to the floor —
  // ORB orders only; the bill being cancelled here keeps its one update + one log.
    if (order.isChallanOrder) await releaseChallanOnCancel(orderId, userId);
    // ONE log per bill. The note is what the Cancel & CI tab reads.
    await prisma.order_status_logs.create({
      data: {
        orderId,
        fromStage: order.workflowStage,
        toStage: "cancelled",
        changedById: userId,
        note: `CI raised — ${ciNumber} · ${noteReasonLabel}`,
      },
    });

    return { ok: true, orderId, obdNumber, ciNumber };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error(`[floor/ci] order #${orderId}${ciNumber ? ` (${ciNumber})` : ""} failed:`, err);
    return {
      ok: false,
      orderId,
      obdNumber,
      reason:
        ciNumber !== null
          ? `${ciNumber} was raised but the bill could not be taken off the floor — try again (${message})`
          : message,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// A CI PER INVOICE (Add invoices 6.3, 2026-10-19) — a SPLIT OBD's invoice row
// ═══════════════════════════════════════════════════════════════════════════
//
// Floor's Raise CI on ticked invoices of a split OBD (partial selection): ONE
// CI per invoice row. Rules: lib/order-invoices/ci-plan.ts (tested).
//   a. the order (not removed); b0 challan admin-only; b. the STAGE refusals
//      of offFloorRefusal (cancelled / dispatched / tint room — never its trip
//      arm: the invoice's own trip decides, below)
//   b2. the invoice: on a trip → "… — remove it from the trip first";
//       dispatched → refused. HELD is allowed (a CI from On hold is real).
//   c. duplicate guard per (orderId, orderInvoiceId): a live CI on this row or
//      a whole-OBD CI (orderInvoiceId NULL) → skipped; a draft → skipped.
//   d. the lines: the invoice's order_invoice_lines at its tins, active raw
//      lines only (invoiceCiPicks) → deriveCiLineRows, as a manual CI stores.
//   e. ONE nested create at 'submitted', returnType 'full' (the whole
//      INVOICE), orderInvoiceId = the row, invoiceNo / invoiceDate = the row's.
//   f. NO orders write — the OBD is not cancelled (Cancel stays per OBD); its
//      other invoices stay where they are. (6.4: unless this CI finishes the
//      OBD under the done rule — settleObdDone writes dispatched then.) ONE order_status_logs row (the
//      stage unchanged) "CI raised — {ciNumber} · {reason} · {invoice}" with
//      "orderInvoiceIds" = [row] (v27.72), so the per-invoice Activity shows it.
//      The ci_returns live triggers tell the board (entity 'order').
// A retry after a press died between e and f finds its CI in (c) and is
// skipped "Already has CI-…" — the CI stands; only its log line is missing.
// Never throws. Sequential awaits, never prisma.$transaction (CORE §3).

export type RaiseInvoiceCiResult =
  | { ok: true; orderId: number; obdNumber: string; ciNumber: string; invoiceRowId: number; invoiceNo: string | null }
  | { ok: false; orderId: number; obdNumber: string | null; reason: string; invoiceRowId: number; invoiceNo: string | null };

export async function raiseInvoiceCi(args: {
  orderId: number;
  invoiceRowId: number;
  reason: { id: number; label: string };
  remark: string | null;
  userId: number;
  actorIsAdmin?: boolean;
}): Promise<RaiseInvoiceCiResult> {
  const { orderId, invoiceRowId, reason, remark, userId } = args;
  let obdNumber: string | null = null;
  let invoiceNo: string | null = null;
  let ciNumber: string | null = null;
  const fail = (why: string): RaiseInvoiceCiResult => ({ ok: false, orderId, obdNumber, reason: why, invoiceRowId, invoiceNo });
  try {
    // ── a. The order and its invoice rows ─────────────────────────────────
    const order = await prisma.orders.findFirst({
      where: { id: orderId, isRemoved: false },
      select: {
        id: true,
        obdNumber: true,
        invoiceNo: true,
        invoiceDate: true,
        customerId: true,
        shipToCustomerId: true,
        shipToCustomerName: true,
        shipToOverrideCustomer: { select: { customerName: true } },
        customer: { select: { customerName: true } },
        soNumber: true,
        workflowStage: true,
        isChallanOrder: true,
        invoices: {
          orderBy: { seq: "asc" },
          select: {
            id: true,
            seq: true,
            invoiceNo: true,
            invoiceDate: true,
            tripDropId: true,
            isDispatched: true,
            tripDrop: { select: { trip: { select: { tripNumber: true } } } },
            lines: { select: { rawLineItemId: true, qty: true } },
          },
        },
      },
    });
    if (order === null) return fail("Order not found");
    obdNumber = order.obdNumber;

    // ── b0 / b. The OBD's own refusals ────────────────────────────────────
    const challanRefusal = challanCancelRefusal(order.isChallanOrder, args.actorIsAdmin === true);
    if (challanRefusal !== null) return fail(challanRefusal);
    const stage = offFloorRefusal({ workflowStage: order.workflowStage, tripDropId: null, tripNumber: null });
    if (stage !== null) return fail(stage);
    if (order.invoices.length < 2) return fail("Not a split OBD — raise the CI on the whole bill");
    const found = order.invoices.find((r) => r.id === invoiceRowId);
    if (!found) return fail(`Invoice row ${invoiceRowId} is not an invoice of ${order.obdNumber}`);
    const row = {
      id: found.id,
      seq: found.seq,
      invoiceNo: found.invoiceNo,
      tripDropId: found.tripDropId,
      tripNumber: found.tripDrop?.trip.tripNumber ?? null,
      isDispatched: found.isDispatched,
      lines: found.lines,
    };
    invoiceNo = row.invoiceNo;

    // ── b2. The invoice's own refusals ─────────────────────────────────────
    const refusal = invoiceCiRefusal(row);
    if (refusal !== null) return fail(refusal);

    // ── c. Duplicate guard per (orderId, orderInvoiceId) ──────────────────
    const cis = await prisma.ci_returns.findMany({
      where: { orderId, isVoided: false },
      orderBy: { id: "asc" },
      select: { id: true, ciNumber: true, status: true, orderInvoiceId: true },
    });
    const dup = invoiceCiDuplicate(cis, row.id);
    if (dup !== null) return fail(dup);

    // ── d. The invoice's lines ────────────────────────────────────────────
    const picks = invoiceCiPicks(row, await readActiveBillLines(order.obdNumber));
    if (!picks.ok) return fail(picks.reason);
    const lines = await deriveCiLineRows(picks.picks);

    // ── e. ONE nested create at 'submitted' ───────────────────────────────
    const now = new Date();
    const istDay = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const materialReceivedDate = new Date(`${istDay}T00:00:00Z`);
    const billTo = (await loadBillToByObd([order.obdNumber])).get(order.obdNumber);
    const MAX_ATTEMPTS = 2;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && ciNumber === null; attempt += 1) {
      const identity = await allocateCiNumber(now);
      try {
        const created = await prisma.ci_returns.create({
          data: {
            orderId: order.id,
            orderInvoiceId: row.id,
            obdNumber: order.obdNumber,
            // THIS invoice's number and date (seq 1's is the OBD's own).
            invoiceNo: row.invoiceNo ?? (row.seq === 1 ? order.invoiceNo : null),
            invoiceDate: found.invoiceDate ?? (row.seq === 1 ? order.invoiceDate : null),
            soNumber: order.soNumber,
            customerId: order.customerId,
            customerCode: order.shipToCustomerId,
            customerName: resolveCiDealer(order),
            ...ciPartyColumns(billTo, order),
            returnType: "full",
            materialMoved: "not_moved",
            materialReceivedDate,
            reasonId: reason.id,
            reasonLabel: reason.label,
            reasonRemark: remark,
            supervisorId: userId,
            ciNumber: identity.ciNumber,
            status: "submitted",
            submittedAt: now,
            source: "floor",
            lines: { create: lines },
          },
          select: { ciNumber: true },
        });
        ciNumber = created.ciNumber ?? identity.ciNumber;
      } catch (err) {
        const collided = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
        if (collided && attempt < MAX_ATTEMPTS) continue;
        throw err;
      }
    }
    if (ciNumber === null) return fail("Could not allocate a CI number — try again");

    // ── f. ONE log, about THIS invoice — no orders write ───────────────────
    await prisma.order_status_logs.create({
      data: {
        orderId,
        fromStage: order.workflowStage,
        toStage: order.workflowStage,
        changedById: userId,
        note: `CI raised — ${ciNumber} · ${reason.label} · ${ciInvoiceLabel(row)}`,
        orderInvoiceIds: [row.id],
      },
    });
    // 6.4 — THE DONE RULE: if this was the OBD's last open invoice and the
    // others shipped, the OBD is dispatched now (lib/order-invoices/dispatch.ts;
    // ONE orders write, ONE log, only then; never throws).
    await settleObdDone(orderId, userId, `Dispatched — last open invoice returned on ${ciNumber}`);
    return { ok: true, orderId, obdNumber, ciNumber, invoiceRowId, invoiceNo };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error(`[floor/ci] order #${orderId} invoice row ${invoiceRowId}${ciNumber ? ` (${ciNumber})` : ""} failed:`, err);
    return fail(ciNumber !== null ? `${ciNumber} was raised but its log line failed (${message})` : message);
  }
}
