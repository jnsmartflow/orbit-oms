import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { isFindingReason } from "@/lib/picking/findings-reasons";

export const dynamic = "force-dynamic";

/**
 * POST /api/picking/findings/confirm — the SUPERVISOR signs off what was
 * actually found on one line.
 *
 * Body: { orderId, rawLineItemId, qtyFound, reason }
 *
 * ⚠ canEdit, NOT canView — and that is the whole difference from
 * app/api/picking/findings/report/route.ts. This is a supervisor action, so it
 * joins assign / unassign / approve / release on canEdit (CLAUDE_PICKING.md §7:
 * `picker` holds canView ONLY, so this gate is what keeps a picker from
 * confirming his own report by calling the API directly). report/route.ts and
 * done/route.ts are the two deliberate canView exceptions — do not "align" this
 * one with them.
 *
 * There is NO pickerId ownership check here, deliberately: any of the three
 * supervisors may approve any bill (§6, "no 'only the assigner approves' rule"),
 * so ownership is not the boundary — canEdit is.
 *
 * WRITE RULES:
 *   • No row yet  → INSERT with recordedById/recordedAt set and reportedById
 *                   LEFT NULL. This is a supervisor recording a line from
 *                   scratch, with no picker report behind it.
 *   • Row exists  → UPDATE qtyFound/reason and stamp recordedById/recordedAt
 *                   FRESH, but ⚠ NEVER touch reportedById/reportedAt. Who first
 *                   reported a shortage is a fact about the floor, and a
 *                   supervisor confirming it — or re-confirming it later with
 *                   different numbers — must not overwrite that attribution.
 *                   Unlike report/route.ts, an already-confirmed row is NOT a
 *                   409 here: a supervisor correcting his own earlier number is
 *                   the expected path.
 *
 * `reason` is validated against lib/picking/findings-reasons.ts BEFORE any
 * write — chk_pick_findings_reason is invisible to Prisma, so this is the only
 * thing turning a bad value into a clean 400 instead of a raw constraint error.
 *
 * Sequential awaits only, never prisma.$transaction (CORE §3).
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // canEdit — the supervisor gate. Same shape as approve/route.ts (the admin
  // bypass lives inside checkAnyPermission, so no wrapper is needed).
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "picking", "canEdit");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // WHO CONFIRMED — the real session, never a request-body claim. Same rule
  // approve/route.ts applies to checkedById.
  const recordedById = Number(session.user.id);
  if (!Number.isInteger(recordedById) || recordedById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    orderId?:       number;
    rawLineItemId?: number;
    qtyFound?:      number;
    reason?:        string;
    remarks?:       string | null;
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

  const reason = body.reason;
  if (!isFindingReason(reason)) {
    return NextResponse.json(
      { error: "reason must be 'short_quantity' or 'old_mfg'" },
      { status: 400 },
    );
  }

  // ⚠ ABSENT remarks means LEAVE IT ALONE, not "clear it". The popup no longer
  // collects remarks (2026-08-08), so this key is normally missing — and a
  // supervisor confirming a picker's report must not wipe a remark the picker
  // typed before the field was removed. Only an explicitly supplied value
  // writes. Same rule in report/route.ts.
  const remarksProvided = body.remarks !== undefined;
  const remarksValue =
    typeof body.remarks === "string" && body.remarks.trim() !== "" ? body.remarks.trim() : null;

  // Soft-delete read (CORE §3) — never record against a removed order.
  const order = await prisma.orders.findFirst({
    where: { id: orderId, isRemoved: false },
    select: { id: true, obdNumber: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // ⚠ THE LINE MUST BELONG TO THIS BILL. rawLineItemId arrives from the client
  // and there is no FK from `orders` to its line items (matched on the plain
  // obdNumber string), so without this a finding could be attached to a
  // completely different bill's line. Same guard report/route.ts makes.
  const rawLine = await prisma.import_raw_line_items.findUnique({
    where: { id: rawLineItemId },
    select: { id: true, obdNumber: true, lineId: true, skuCodeRaw: true, unitQty: true, lineStatus: true },
  });
  if (!rawLine || rawLine.obdNumber !== order.obdNumber) {
    return NextResponse.json({ error: "That line does not belong to this bill." }, { status: 400 });
  }
  if (rawLine.lineStatus !== "active") {
    return NextResponse.json(
      { error: "That line is no longer active on this bill." },
      { status: 409 },
    );
  }

  // Found-more-than-ordered is a typo, not a finding. Same bound report/route.ts
  // applies — kept in code, not the DB, so relaxing it is a one-line change.
  if (qtyFound > rawLine.unitQty) {
    return NextResponse.json(
      { error: `qtyFound cannot exceed the ${rawLine.unitQty} ordered` },
      { status: 400 },
    );
  }

  const existing = await prisma.pick_findings.findUnique({
    where: { rawLineItemId },
    select: { id: true },
  });

  const now = new Date();

  const SAVED_SELECT = {
    qtyFound: true, reason: true, remarks: true,
    reportedById: true, reportedAt: true, recordedById: true, recordedAt: true,
  } as const;

  if (existing) {
    const updated = await prisma.pick_findings.update({
      where: { rawLineItemId },
      // ⚠ reportedById / reportedAt are ABSENT from this data object on
      // purpose — Prisma leaves an omitted field untouched, which is exactly
      // what preserves the original reporter. Do not add them "for
      // completeness"; adding them is the bug.
      data: {
        qtyFound,
        reason,
        recordedById,
        recordedAt: now,
        ...(remarksProvided ? { remarks: remarksValue } : {}),
      },
      select: SAVED_SELECT,
    });
    return NextResponse.json({ ok: true, finding: updated });
  }

  const created = await prisma.pick_findings.create({
    data: {
      orderId,
      rawLineItemId,
      // Denormalised copies — they must survive the line being soft-removed by
      // a later re-import (CLAUDE_CORE.md §7.4). `lineId` is TEXT here and Int
      // on import_raw_line_items, hence the String().
      obdNumber:  order.obdNumber,
      lineId:     String(rawLine.lineId),
      skuCodeRaw: rawLine.skuCodeRaw,
      qtyOrdered: rawLine.unitQty,
      qtyFound,
      reason,
      remarks: remarksProvided ? remarksValue : null,
      // No picker report behind this one — the supervisor found it himself.
      // reportedById / reportedAt stay NULL, and that NULL is meaningful:
      // it is how "nobody on the floor flagged this" is recorded.
      recordedById,
      recordedAt: now,
    },
    select: SAVED_SELECT,
  });

  return NextResponse.json({ ok: true, finding: created });
}
