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
import { challanCancelRefusal, unlinkWaitingOnCancel } from "@/lib/challan-orders/cancel-guard";
import { prisma } from "@/lib/prisma";
import { allocateCiNumber } from "@/lib/ci/number";
import { resolveCiDealer } from "@/lib/ci/derive";
import { computeFullBillLines } from "@/lib/ci/full-bill";
import { offFloorRefusal } from "@/lib/floor/off-floor";

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
      const MAX_ATTEMPTS = 2;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && ciNumber === null; attempt += 1) {
        const identity = await allocateCiNumber(now);
        try {
          const created = await prisma.ci_returns.create({
            data: {
              orderId: order.id,
              obdNumber: order.obdNumber,
              // May be null — never blocks (CLAUDE_CI §5, §13 CI-1).
              invoiceNo: order.invoiceNo,
              invoiceDate: order.invoiceDate,
              soNumber: order.soNumber,
              customerId: order.customerId,
              customerCode: order.shipToCustomerId,
              customerName: resolveCiDealer(order),
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
    // AFTER the stage write, never before — the ordering and the reason are
    // the floor cancel's (lib/floor/bill-actions.ts, the orphan fix).
    await prisma.pick_assignments.deleteMany({ where: { orderId } });
    // S5-3 — a cancelled ORB order frees its waiting SOs (link table only).
    if (order.isChallanOrder) await unlinkWaitingOnCancel(orderId, userId);
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
