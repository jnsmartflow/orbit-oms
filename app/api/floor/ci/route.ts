import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { FLOOR_REMARK_MAX } from "@/lib/floor/off-floor";
import { findActiveCiReason, listActiveCiReasons, raiseFullBillCi } from "@/lib/floor/raise-ci";

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
 * Since 2026-10-01 (Tint Manager tabs build step 3) steps a–f live in
 * lib/floor/raise-ci.ts raiseFullBillCi, shared with app/api/tint/manager/ci.
 * This route calls it with allowTintRoom false and no beforeWrite — Floor's
 * behaviour, messages and response are unchanged.
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

  const reasons = await listActiveCiReasons();
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
  const reason = await findActiveCiReason(reasonId);
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
    // Never throws — every failure, with Floor's wording, comes back as a skip.
    const r = await raiseFullBillCi({ orderId, reason, remark, userId, allowTintRoom: false });
    if (r.ok) raised.push({ orderId: r.orderId, obdNumber: r.obdNumber, ciNumber: r.ciNumber });
    else skipped.push({ orderId: r.orderId, obdNumber: r.obdNumber, reason: r.reason });
  }

  // Nothing raised → 422, so a fully-skipped press cannot read as success.
  const status = raised.length === 0 ? 422 : 200;
  return NextResponse.json({ raised, skipped }, { status });
}
