import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/rbac";
import { isFindingReason, isMfgMonth, isMfgYear } from "@/lib/picking/findings-reasons";

export const dynamic = "force-dynamic";

/**
 * POST /api/picking/findings/report — the PICKER records what he actually
 * found on one line (short quantity, or old manufacturing date).
 *
 * Body: { orderId, rawLineItemId, qtyFound, reason, mfgMonth?, mfgYear?,
 *         remarks?, pickerId? }
 *
 * `mfgMonth` / `mfgYear` are REQUIRED when reason is 'old_mfg' and FORCED TO
 * NULL when it is 'short_quantity' — see the validation block below for why
 * that rule lives here and not in the database.
 *
 * ⚠ THIS IS THE PICKER'S OWN ACTION, and it is gated exactly like
 * app/api/picking/done/route.ts — on **canView, NOT canEdit**. `picker` holds
 * canView only (CLAUDE_CORE.md §5), so gating this on canEdit would lock the
 * one role it exists for out of it. The boundary that actually protects this
 * route is not the role flag but the pickerId-ownership check below: the bill
 * must really be assigned to the acting picker. That is the same reasoning, and
 * the same shape, done/route.ts already documents at its own gate — do not
 * "harden" this to canEdit.
 *
 * WRITE RULES (the whole point of this route):
 *   • No row yet            → INSERT, reportedById/reportedAt = the real
 *                             session user, recordedById/recordedAt left NULL.
 *   • Row exists, unconfirmed (recordedById IS NULL)
 *                           → UPDATE his own values in place.
 *   • Row exists, CONFIRMED (recordedById IS NOT NULL)
 *                           → 409. A supervisor has already signed off on this
 *                             line and the picker's route must never silently
 *                             overwrite a confirmed record. This is the one
 *                             rule that makes the amber→red ladder trustworthy.
 *
 * `reason` is validated against lib/picking/findings-reasons.ts BEFORE any
 * write, because the live CHECK constraint (chk_pick_findings_reason) is
 * invisible to Prisma — without this the caller would get a raw Postgres
 * constraint error instead of a clean 400.
 *
 * Sequential awaits only, never prisma.$transaction (CORE §3).
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // canView — see the file-top note. Same call shape as done/route.ts (the
  // admin bypass lives inside checkAnyPermission, so no wrapper here).
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "picking", "canView");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // WHO CLICKED — the real session, never a request-body claim. This is what
  // lands in reportedById; the body's pickerId (below) says who the bill is
  // FOR, exactly the split done/route.ts makes between changedById and pickerId.
  const actorId = Number(session.user.id);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    orderId?:       number;
    rawLineItemId?: number;
    qtyFound?:      number;
    reason?:        string;
    remarks?:       string | null;
    mfgMonth?:      number | null;
    mfgYear?:       number | null;
    pickerId?:      number;
  };

  const orderId = body.orderId;
  if (typeof orderId !== "number" || !Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  const rawLineItemId = body.rawLineItemId;
  if (typeof rawLineItemId !== "number" || !Number.isInteger(rawLineItemId) || rawLineItemId <= 0) {
    return NextResponse.json({ error: "rawLineItemId is required" }, { status: 400 });
  }

  const qtyFound = body.qtyFound;
  if (typeof qtyFound !== "number" || !Number.isInteger(qtyFound) || qtyFound < 0) {
    return NextResponse.json(
      { error: "qtyFound must be a whole number of 0 or more" },
      { status: 400 },
    );
  }

  // ⚠ Validated HERE, before any write — chk_pick_findings_reason is invisible
  // to Prisma, so this guard is the only thing turning a bad value into a clean
  // 400 rather than a raw constraint violation.
  const reason = body.reason;
  if (!isFindingReason(reason)) {
    return NextResponse.json(
      { error: "reason must be 'short_quantity' or 'old_mfg'" },
      { status: 400 },
    );
  }

  // ── MFG month/year — reason-dependent, validated HERE ───────────────────
  // 🔴 THE DEPENDENCY IS NOT IN THE DATABASE. The live CHECK only says
  // "mfgMonth IS NULL OR 1..12"; nothing at the DB level ties either column to
  // `reason`. This block IS the rule, and it must be identical in
  // confirm/route.ts — a value that gets past one route is stored just as
  // permanently as one that gets past the other.
  //
  // The 1-12 test is duplicated here rather than left to the CHECK on purpose:
  // the constraint is invisible to Prisma, so relying on it alone would return
  // a raw Postgres constraint violation to the floor instead of a clean 400.
  // Same reasoning as the `reason` guard above.
  //
  // ⚠ CONTRAST WITH `remarks` DIRECTLY BELOW — the opposite rule, deliberately.
  // Absent remarks means "leave it alone"; mfgMonth/mfgYear are written on
  // EVERY save, unconditionally. That is what forces both to NULL on the
  // short_quantity branch and what clears a stale date when someone switches an
  // existing old_mfg row to short_quantity. "Leave it alone" here would let a
  // date outlive the reason that justified it.
  let mfgMonth: number | null = null;
  let mfgYear: number | null = null;
  if (reason === "old_mfg") {
    if (!isMfgMonth(body.mfgMonth)) {
      return NextResponse.json(
        { error: "mfgMonth must be a whole number from 1 to 12 when reason is 'old_mfg'" },
        { status: 400 },
      );
    }
    if (!isMfgYear(body.mfgYear)) {
      return NextResponse.json(
        { error: "mfgYear must be a valid year when reason is 'old_mfg'" },
        { status: 400 },
      );
    }
    mfgMonth = body.mfgMonth;
    mfgYear = body.mfgYear;
  }
  // reason === 'short_quantity' → both stay null, whatever the body claimed.

  // ⚠ ABSENT remarks means LEAVE IT ALONE, not "clear it" (corrected
  // 2026-08-08). The popup stopped collecting remarks when the field was
  // removed from it, so this key is now normally MISSING from the body — and
  // the previous version turned a missing key into `null`, which on the update
  // path would silently wipe a remark typed before the field went away. Only an
  // explicitly supplied value writes. Empty/whitespace still stores as NULL,
  // never "", so a blank never reads downstream as "he wrote something".
  // Same rule in confirm/route.ts.
  const remarksProvided = body.remarks !== undefined;
  const remarksValue =
    typeof body.remarks === "string" && body.remarks.trim() !== "" ? body.remarks.trim() : null;

  // ── Which picker is this for? ────────────────────────────────────────────
  // A real picker's OWN session id always wins; the body's pickerId is honoured
  // only for the admin/operations `?view=picker&as=<id>` preview, the same
  // narrowing app/api/picking/combined/route.ts makes. done/route.ts trusts the
  // body outright and leans entirely on the ownership check below — this is
  // strictly tighter and reaches the identical check.
  const primaryRole = session.user.role;
  const canUseTestHook = roles.includes(ROLES.ADMIN) || roles.includes(ROLES.OPERATIONS);

  let pickerId: number;
  if (primaryRole === "picker") {
    pickerId = actorId;
  } else if (canUseTestHook) {
    const claimed = body.pickerId;
    if (typeof claimed !== "number" || !Number.isInteger(claimed) || claimed <= 0) {
      return NextResponse.json(
        { error: "pickerId is required when recording as another picker" },
        { status: 400 },
      );
    }
    pickerId = claimed;
  } else {
    return NextResponse.json(
      { error: "This action belongs to a picker" },
      { status: 403 },
    );
  }

  // pickerId must resolve to a real, active picker-role user — the same check
  // done/route.ts runs before touching anything.
  const picker = await prisma.users.findFirst({
    where: { id: pickerId, role: { name: "picker" }, isActive: true },
    select: { id: true },
  });
  if (!picker) {
    return NextResponse.json(
      { error: "pickerId does not resolve to an active picker" },
      { status: 400 },
    );
  }

  // Soft-delete read (CORE §3) — never record against a removed order.
  const order = await prisma.orders.findFirst({
    where: { id: orderId, isRemoved: false },
    select: { id: true, obdNumber: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // OWNERSHIP — the real guard behind the view-as hook, byte-for-byte the check
  // done/route.ts makes. A picker (or an admin acting as one) can only record
  // against a bill actually assigned to that picker.
  const assignment = await prisma.pick_assignments.findUnique({
    where: { orderId },
    select: { pickerId: true },
  });
  if (!assignment || assignment.pickerId !== pickerId) {
    return NextResponse.json(
      { error: "This bill is not assigned to that picker." },
      { status: 409 },
    );
  }

  // ⚠ THE LINE MUST BELONG TO THIS BILL. rawLineItemId arrives from the client
  // and there is no FK from `orders` to its line items (they are matched on the
  // plain obdNumber string), so nothing else in this request would stop a
  // finding being attached to ANOTHER bill's line — one the picker has no claim
  // to at all. done/route.ts needs no equivalent because it takes no line id.
  const rawLine = await prisma.import_raw_line_items.findUnique({
    where: { id: rawLineItemId },
    select: { id: true, obdNumber: true, lineId: true, skuCodeRaw: true, unitQty: true, lineStatus: true },
  });
  if (!rawLine || rawLine.obdNumber !== order.obdNumber) {
    return NextResponse.json(
      { error: "That line does not belong to this bill." },
      { status: 400 },
    );
  }
  if (rawLine.lineStatus !== "active") {
    return NextResponse.json(
      { error: "That line is no longer active on this bill." },
      { status: 409 },
    );
  }

  // Found-more-than-ordered is a typo, not a finding. Bounded here rather than
  // in the DB because it is a judgement about this feature, not an invariant of
  // the table — relaxing it is a one-line change if the floor ever needs it.
  if (qtyFound > rawLine.unitQty) {
    return NextResponse.json(
      { error: `qtyFound cannot exceed the ${rawLine.unitQty} ordered` },
      { status: 400 },
    );
  }

  // ── The upsert, done as read-then-branch ─────────────────────────────────
  // NOT prisma.upsert(): the "already confirmed" case must 409 rather than
  // write, and upsert() cannot express a conditional refusal. Sequential awaits
  // throughout, never $transaction (CORE §3).
  const existing = await prisma.pick_findings.findUnique({
    where: { rawLineItemId },
    select: { id: true, recordedById: true },
  });

  const now = new Date();

  if (existing && existing.recordedById !== null) {
    // A supervisor has signed this off. The picker's route stops here — always.
    return NextResponse.json(
      { error: "A supervisor has already confirmed this line." },
      { status: 409 },
    );
  }

  if (existing) {
    const updated = await prisma.pick_findings.update({
      where: { rawLineItemId },
      // reportedById is re-stamped: whoever last recorded it is the reporter.
      // recordedById/recordedAt are deliberately NOT touched — they are the
      // supervisor's to set, and they are NULL here by the guard above.
      data: {
        qtyFound,
        reason,
        // Unconditional — see the validation block above. This is what clears a
        // stale date when an old_mfg row is edited down to short_quantity.
        mfgMonth,
        mfgYear,
        reportedById: actorId,
        reportedAt: now,
        ...(remarksProvided ? { remarks: remarksValue } : {}),
      },
      select: {
        id: true, qtyFound: true, reason: true, remarks: true,
        mfgMonth: true, mfgYear: true,
        reportedById: true, reportedAt: true, recordedById: true, recordedAt: true,
      },
    });
    return NextResponse.json({ ok: true, finding: updated });
  }

  const created = await prisma.pick_findings.create({
    data: {
      orderId,
      rawLineItemId,
      // Denormalised copies — they must survive the line being soft-removed by
      // a later re-import (CLAUDE_CORE.md §7.4). `lineId` is TEXT on this table
      // and Int on import_raw_line_items, hence the String().
      obdNumber:  order.obdNumber,
      lineId:     String(rawLine.lineId),
      skuCodeRaw: rawLine.skuCodeRaw,
      qtyOrdered: rawLine.unitQty,
      qtyFound,
      reason,
      // Both null unless reason is old_mfg — the validation block above is the
      // only thing that sets them.
      mfgMonth,
      mfgYear,
      remarks: remarksProvided ? remarksValue : null,
      reportedById: actorId,
      reportedAt:   now,
      // recordedById / recordedAt stay NULL — this is a report, not a
      // confirmation. Only the supervisor's own route may set them.
    },
    select: {
      id: true, qtyFound: true, reason: true, remarks: true,
      mfgMonth: true, mfgYear: true,
      reportedById: true, reportedAt: true, recordedById: true, recordedAt: true,
    },
  });

  return NextResponse.json({ ok: true, finding: created });
}
