import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { allocateCiNumber } from "@/lib/ci/number";
import { resolveCiDealer } from "@/lib/ci/derive";
import { computeFullBillLines } from "@/lib/ci/full-bill";
import { FLOOR_REMARK_MAX, offFloorRefusal } from "@/lib/floor/off-floor";

export const dynamic = "force-dynamic";

/**
 * POST /api/floor/ci — raise a FULL-BILL CI for each ticked bill and take the
 * bill off the floor (floor-bulk-actions v5, 2026-09-22).
 *
 * Body:     { orderIds: number[], reasonId: number, remark?: string (≤ 500) }
 * Response: { raised:  [{ orderId, obdNumber, ciNumber }],
 *             skipped: [{ orderId, obdNumber, reason }] }
 *           200 when at least one was raised; 422 when nothing was.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 THE THIRD CI WRITER; GATED ON floor.canEdit BY OWNER DECISION 2026-09-22
 * ═══════════════════════════════════════════════════════════════════════════
 * The other writers are the /ci routes (a supervisor's phone — `ci` ticks plus
 * SUBMIT_ROLES) and the two system paths (lib/ci/auto.ts, lib/ci/bill-only.ts).
 * This one takes NO `ci` tick and NO role list: the Floor desk users hold
 * `floor` canEdit and nothing on /ci, and the owner chose not to widen /ci to
 * them. Deliberate — do not "align" it with SUBMIT_ROLES.
 *
 * ── What each CI is (fixed, owner) ─────────────────────────────────────────
 *   one CI per bill · returnType 'full' (every active line at its delivered
 *   quantity — lib/ci/full-bill.ts, the SAME rows a manual 'full' CI stores) ·
 *   materialMoved 'not_moved' ("goods in depot") · materialReceivedDate = IST
 *   today · status 'submitted' (straight onto billing's desk) · source 'floor'
 *   · reason = one active ci_reason_master row, label snapshotted · remark →
 *   reasonRemark · supervisorId = the desk user who pressed it.
 *   🔴 A missing invoiceNo NEVER blocks (CLAUDE_CI §5): it snapshots as null
 *   and every read path shows the live order value once SAP sends it.
 *
 * ── Per bill, in this order ─────────────────────────────────────────────────
 *   a. the order (not removed)
 *   b. offFloorRefusal — cancelled / dispatched / on a trip / in the tint room
 *   c. duplicate guard — ANY live (non-voided, non-draft) CI, ANY source:
 *        a 'floor' CI on a bill still on the floor → a previous press created
 *        the CI and then failed to take the bill off: skip the create, finish
 *        (f). That is what makes a retry safe.
 *        anything else → skipped "Already has CI-…".
 *      an open draft on /ci → skipped: two people would be returning one bill.
 *   d. the full-bill lines; a bill that cannot be returned in full is skipped
 *   e. ONE nested create at 'submitted' — auto.ts / bill-only.ts's form:
 *      allocate the number, create header + lines, re-allocate ONCE on P2002
 *   f. ONE orders.update {cancelled, dispatchStatus null} → pick_assignments
 *      cleared → ONE order_status_logs row "CI raised — {ciNumber} · {reason}"
 *      — the same three writes, in the same order, as the floor cancel.
 *
 * A bill's failure is reported in `skipped` and never fails the batch.
 * Sequential awaits, never prisma.$transaction (CORE §3).
 *
 * NOT copied from lib/ci/auto.ts, on purpose: its invoice fire rule, the
 * pick_findings read, the due-lines / old-MFG rule, its (orderId + source)
 * find-or-create, freeze/delete, reason-by-code, returnType 'part', and the
 * line reconcile. Those are the findings path's, not this one's.
 */

/**
 * GET /api/floor/ci — the CI reasons the Floor form offers.
 *
 * → { reasons: [{ id, label, isPinned, sortOrder }] } — ACTIVE rows only,
 *   pinned first, then sortOrder (then id, so equal sort orders are stable).
 *
 * ⚠ WHY NOT /api/ci/reasons: that route gates on `ci` canView, and the Floor
 * desk users hold no `ci` ticks (owner decision 2026-09-22 — see POST below).
 * Same gate as the POST it feeds: floor.canEdit. The list is DATA
 * (CLAUDE_CI §3) — never hardcoded on the client.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const reasons = await prisma.ci_reason_master.findMany({
    where: { isActive: true },
    orderBy: [{ isPinned: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, label: true, isPinned: true, sortOrder: true },
  });
  return NextResponse.json({ reasons });
}

interface Body {
  orderIds?: unknown;
  reasonId?: unknown;
  remark?: unknown;
}

interface Raised {
  orderId: number;
  obdNumber: string;
  ciNumber: string;
}

interface Skipped {
  orderId: number;
  obdNumber: string | null;
  reason: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const userId = Number(session.user.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;

  // ── Validate once ─────────────────────────────────────────────────────────
  const rawIds = body.orderIds;
  if (
    !Array.isArray(rawIds) ||
    rawIds.length === 0 ||
    !rawIds.every((id) => typeof id === "number" && Number.isInteger(id) && id > 0)
  ) {
    return NextResponse.json({ error: "orderIds is required and must be a non-empty array of positive integers" }, { status: 400 });
  }
  // A double-listed id would reach the duplicate guard the second time and be
  // reported as "Already has CI-…" against itself. Once each.
  const orderIds = Array.from(new Set(rawIds as number[]));

  const reasonId = body.reasonId;
  if (typeof reasonId !== "number" || !Number.isInteger(reasonId) || reasonId <= 0) {
    return NextResponse.json({ error: "reasonId is required and must be a positive integer" }, { status: 400 });
  }
  // 🔴 THE REASON IS DATA (CLAUDE_CI §3): any ACTIVE row, never a hardcoded id
  // or list. The label is snapshotted from this row, never composed.
  const reason = await prisma.ci_reason_master.findFirst({
    where: { id: reasonId, isActive: true },
    select: { id: true, label: true },
  });
  if (reason === null) {
    return NextResponse.json({ error: "Unknown or inactive CI reason" }, { status: 400 });
  }

  let remark: string | null = null;
  if (body.remark !== undefined && body.remark !== null) {
    if (typeof body.remark !== "string") {
      return NextResponse.json({ error: "remark must be a string" }, { status: 400 });
    }
    const trimmed = body.remark.trim();
    if (trimmed.length > FLOOR_REMARK_MAX) {
      return NextResponse.json({ error: `remark is longer than ${FLOOR_REMARK_MAX} characters` }, { status: 400 });
    }
    // Blank collapses to null, as the submit route does.
    remark = trimmed === "" ? null : trimmed;
  }

  const raised: Raised[] = [];
  const skipped: Skipped[] = [];

  for (const orderId of orderIds) {
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
          tripDropId: true,
          tripDrop: { select: { trip: { select: { tripNumber: true } } } },
        },
      });
      if (order === null) {
        skipped.push({ orderId, obdNumber: null, reason: "Order not found" });
        continue;
      }
      obdNumber = order.obdNumber;

      // ── b. Refusals — the same ones the floor cancel applies ──────────────
      const refusal = offFloorRefusal({
        workflowStage: order.workflowStage,
        tripDropId: order.tripDropId,
        tripNumber: order.tripDrop?.trip.tripNumber ?? null,
      });
      if (refusal !== null) {
        skipped.push({ orderId, obdNumber, reason: refusal });
        continue;
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
        } else {
          skipped.push({
            orderId,
            obdNumber,
            reason: `Already has ${existing.ciNumber ?? `CI #${existing.id}`}`,
          });
          continue;
        }
      } else {
        const draft = await prisma.ci_returns.findFirst({
          where: { orderId, isVoided: false, status: "draft" },
          select: { id: true },
        });
        if (draft !== null) {
          skipped.push({ orderId, obdNumber, reason: "A CI draft is open on /ci for this bill" });
          continue;
        }

        // ── d. Every active line at its delivered quantity ──────────────────
        const full = await computeFullBillLines(order.obdNumber);
        if (!full.ok) {
          skipped.push({
            orderId,
            obdNumber,
            reason:
              full.reason === "no_lines"
                ? "The bill has no active lines to return"
                : `${full.lineIds.length} line(s) have no delivered quantity, so it cannot be returned in full — use Part on /ci`,
          });
          continue;
        }

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
          skipped.push({ orderId, obdNumber, reason: "Could not allocate a CI number — try again" });
          continue;
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
      // the floor cancel's (app/api/floor/actions/route.ts, the orphan fix).
      await prisma.pick_assignments.deleteMany({ where: { orderId } });
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

      raised.push({ orderId, obdNumber, ciNumber });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      console.error(`[floor/ci] order #${orderId}${ciNumber ? ` (${ciNumber})` : ""} failed:`, err);
      skipped.push({
        orderId,
        obdNumber,
        reason:
          ciNumber !== null
            ? `${ciNumber} was raised but the bill could not be taken off the floor — try again (${message})`
            : message,
      });
    }
  }

  // Nothing raised → 422, so a fully-skipped press cannot read as success.
  const status = raised.length === 0 ? 422 : 200;
  return NextResponse.json({ raised, skipped }, { status });
}
