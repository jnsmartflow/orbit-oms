import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { isFindingReason, isMfgMonth, isMfgYear, type FindingReason } from "@/lib/picking/findings-reasons";
import { reconcileAutoCi, type CiAutoOrder } from "@/lib/ci/auto";
import { allocateFoundQty, normaliseLineIds } from "@/lib/picking/allocate-finding";

export const dynamic = "force-dynamic";

/**
 * POST /api/picking/findings/confirm — the SUPERVISOR signs off what was
 * actually found on one line.
 *
 * Body: { orderId, rawLineItemId | rawLineItemIds, qtyFound, reason, mfgMonth?,
 *         mfgYear? }
 *
 * MERGED ROWS (2026-10-06) — the same shape report/route.ts takes, through the
 * same two helpers (lib/picking/allocate-finding.ts): both body shapes become
 * one id array, ONE qtyFound against the merged total is split across the
 * lines in lineId order, every line is checked before the first write, and
 * each line goes through the one per-line write (writeLine below). The auto-CI
 * runs ONCE after every line is written. A single-line row still sends
 * `rawLineItemId` and is a one-element array all the way through.
 *
 * Response: { ok, finding, findings: [{ rawLineItemId, finding }] } — `finding`
 * is the first line's (lineId order), kept for any caller that reads only it.
 *
 * `mfgMonth` / `mfgYear` are REQUIRED when reason is 'old_mfg' and FORCED TO
 * NULL when it is 'short_quantity' — the SAME rule, in the same shape, as
 * report/route.ts. The two must not drift: a supervisor correcting a picker's
 * old_mfg line down to short_quantity has to clear the date here just as the
 * picker's own route would.
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
    rawLineItemIds?: number[];
    qtyFound?:      number;
    reason?:        string;
    remarks?:       string | null;
    mfgMonth?:      number | null;
    mfgYear?:       number | null;
  };

  const orderId = body.orderId;
  if (typeof orderId !== "number" || !Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  // One array from either body shape — a single-line row is [rawLineItemId].
  const idsResult = normaliseLineIds(body);
  if (!idsResult.ok) {
    return NextResponse.json({ error: idsResult.error }, { status: 400 });
  }
  const rawLineItemIds = idsResult.ids;

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

  // ── MFG month/year — reason-dependent, validated HERE ───────────────────
  // 🔴 THE DEPENDENCY IS NOT IN THE DATABASE. The live CHECK only says
  // "mfgMonth IS NULL OR 1..12"; nothing ties either column to `reason`. This
  // block IS the rule, and it is deliberately IDENTICAL to the one in
  // report/route.ts — two routes write this table, and a value that gets past
  // either is stored just as permanently.
  //
  // The 1-12 test is repeated here rather than left to the CHECK because that
  // constraint is invisible to Prisma: relying on it alone returns a raw
  // Postgres constraint violation instead of a clean 400.
  //
  // ⚠ CONTRAST WITH `remarks` BELOW — the opposite rule, on purpose. Absent
  // remarks means "leave it alone"; these two are written on EVERY save. That
  // is what forces both to NULL on the short_quantity branch, and it is the
  // whole reason a supervisor can correct an old_mfg row down to a short
  // quantity without leaving an orphaned date behind it.
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

  // ⚠ ABSENT remarks means LEAVE IT ALONE, not "clear it". The popup no longer
  // collects remarks (2026-08-08), so this key is normally missing — and a
  // supervisor confirming a picker's report must not wipe a remark the picker
  // typed before the field was removed. Only an explicitly supplied value
  // writes. Same rule in report/route.ts.
  const remarksProvided = body.remarks !== undefined;
  const remarksValue =
    typeof body.remarks === "string" && body.remarks.trim() !== "" ? body.remarks.trim() : null;

  // Soft-delete read (CORE §3) — never record against a removed order.
  //
  // ⚠ THE EXTRA FIELDS ARE FOR THE AUTO-CI, AND THIS IS THE ONLY QUERY FOR THEM.
  // lib/ci/auto.ts needs the invoice, the customer snapshot and the SO number;
  // all of it lives on this row, which was already being fetched. A second
  // findFirst for the same order would be a query bought for nothing.
  //
  // 🔴 `invoiceNo` IS THE TRIGGER — the DATABASE COLUMN, not billing's "Already
  // invoiced" badge, not `invoicedAt`, not any marker. That badge means two
  // different things (the invoice genuinely arrived early, or the operator
  // forgot to mark done), so it cannot be a trigger.
  const order = await prisma.orders.findFirst({
    where: { id: orderId, isRemoved: false },
    select: {
      id: true,
      obdNumber: true,
      invoiceNo: true,
      invoiceDate: true,
      customerId: true,
      // ⚠ THE CODE IS `shipToCustomerId`, and the NAME comes from the two dealer
      // relations through resolveCiDealer() — exactly what lib/ci/queries.ts's
      // bill route does for the manual path (queries.ts:305-312). `orders` has
      // no customerCode/customerName columns of its own; snapshotting anything
      // else here would put a different dealer on an auto CI than on a manual
      // one for the same bill.
      shipToCustomerId: true,
      shipToCustomerName: true,
      shipToOverrideCustomer: { select: { customerName: true } },
      customer: { select: { customerName: true } },
      soNumber: true,
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // ⚠ THE LINE MUST BELONG TO THIS BILL. rawLineItemId arrives from the client
  // and there is no FK from `orders` to its line items (matched on the plain
  // obdNumber string), so without this a finding could be attached to a
  // completely different bill's line. Same guard report/route.ts makes. A
  // merged row has every one of its lines checked, in the order sent, before
  // anything is written.
  const foundLines = await prisma.import_raw_line_items.findMany({
    where: { id: { in: rawLineItemIds } },
    select: { id: true, obdNumber: true, lineId: true, skuCodeRaw: true, unitQty: true, lineStatus: true },
  });
  const lineById = new Map(foundLines.map((l) => [l.id, l]));
  const rawLines: RawLine[] = [];
  for (const id of rawLineItemIds) {
    const rawLine = lineById.get(id);
    if (!rawLine || rawLine.obdNumber !== order.obdNumber) {
      return NextResponse.json({ error: "That line does not belong to this bill." }, { status: 400 });
    }
    if (rawLine.lineStatus !== "active") {
      return NextResponse.json(
        { error: "That line is no longer active on this bill." },
        { status: 409 },
      );
    }
    rawLines.push(rawLine);
  }
  // A merged row is ONE SKU by construction (group-lines.ts keys on the SAP
  // code), so lines of different SKUs are not a row the screen could show.
  if (rawLines.some((l) => l.skuCodeRaw !== rawLines[0].skuCodeRaw)) {
    return NextResponse.json({ error: "Those lines are not the same SKU." }, { status: 400 });
  }

  // Found-more-than-ordered is a typo, not a finding. Same bound report/route.ts
  // applies — kept in code, not the DB, so relaxing it is a one-line change. On
  // a merged row the bound is the MERGED total, split across the lines by the
  // SAME helper report/route.ts uses (lib/picking/allocate-finding.ts).
  const allocation = allocateFoundQty(rawLines, qtyFound);
  if (!allocation.ok) {
    return NextResponse.json({ error: allocation.error }, { status: 400 });
  }

  const existingRows = await prisma.pick_findings.findMany({
    where: { rawLineItemId: { in: rawLineItemIds } },
    select: { rawLineItemId: true },
  });
  const existingLineIds = new Set(existingRows.map((e) => e.rawLineItemId));

  const now = new Date();

  const SAVED_SELECT = {
    qtyFound: true, reason: true, remarks: true,
    mfgMonth: true, mfgYear: true,
    reportedById: true, reportedAt: true, recordedById: true, recordedAt: true,
  } as const;
  const bill = order;
  // Pinned: the isFindingReason narrowing does not reach into writeLine.
  const findingReason: FindingReason = reason;

  // THE per-line write. A single-line row calls it once; a merged row calls it
  // once per line. There is no second write path.
  async function writeLine(rawLine: RawLine, lineQtyFound: number) {
    const rawLineItemId = rawLine.id;
    if (existingLineIds.has(rawLineItemId)) {
      return prisma.pick_findings.update({
        where: { rawLineItemId },
        // ⚠ reportedById / reportedAt are ABSENT from this data object on
        // purpose — Prisma leaves an omitted field untouched, which is exactly
        // what preserves the original reporter. Do not add them "for
        // completeness"; adding them is the bug.
        data: {
          qtyFound: lineQtyFound,
          reason: findingReason,
          // Unconditional — see the validation block above. This is what clears a
          // picker's date when the supervisor re-files the line as a shortage.
          mfgMonth,
          mfgYear,
          recordedById,
          recordedAt: now,
          ...(remarksProvided ? { remarks: remarksValue } : {}),
        },
        select: SAVED_SELECT,
      });
    }

    return prisma.pick_findings.create({
      data: {
        orderId: bill.id,
        rawLineItemId,
        // Denormalised copies — they must survive the line being soft-removed by
        // a later re-import (CLAUDE_CORE.md §7.4). `lineId` is TEXT here and Int
        // on import_raw_line_items, hence the String().
        obdNumber:  bill.obdNumber,
        lineId:     String(rawLine.lineId),
        skuCodeRaw: rawLine.skuCodeRaw,
        qtyOrdered: rawLine.unitQty,
        qtyFound: lineQtyFound,
        reason: findingReason,
        // Both null unless reason is old_mfg — the validation block above is the
        // only thing that sets them. Every line of a merged row gets the same.
        mfgMonth,
        mfgYear,
        remarks: remarksProvided ? remarksValue : null,
        // No picker report behind this one — the supervisor found it himself.
        // reportedById / reportedAt stay NULL, and that NULL is meaningful:
        // it is how "nobody on the floor flagged this" is recorded.
        recordedById,
        recordedAt: now,
      },
      select: SAVED_SELECT,
    });
  }

  // One line at a time, in lineId order — sequential awaits, never $transaction.
  const findings: { rawLineItemId: number; finding: Awaited<ReturnType<typeof writeLine>> }[] = [];
  for (const part of allocation.lines) {
    const rawLine = lineById.get(part.id)!;
    findings.push({ rawLineItemId: rawLine.id, finding: await writeLine(rawLine, part.qtyFound) });
  }

  // The confirm is written — EVERY line of it. Everything below is the side
  // effect, run ONCE for the whole save: reconcileAutoCi re-derives the bill's
  // due lines from all its confirmed findings, so once per order is complete.
  await raiseAutoCi(order, recordedById, rawLineItemIds);
  return NextResponse.json({ ok: true, finding: findings[0].finding, findings });
}

/** The `import_raw_line_items` columns this route reads for each line. */
interface RawLine {
  id: number;
  obdNumber: string;
  lineId: number;
  skuCodeRaw: string;
  unitQty: number;
  lineStatus: string;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 THE AUTO-CI, AND IT MUST NEVER BLOCK THE CONFIRM.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The findings board is the primary job here; raising a return is a SIDE
 * EFFECT. The confirm is already written by the time this runs, so a failure in
 * lib/ci/auto.ts is LOGGED and swallowed — it must not roll back, must not turn
 * a successful confirm into an error the supervisor sees, and must not leave him
 * tapping Confirm again on a line that is already recorded.
 *
 * ⚠ AWAITED, NOT FIRE-AND-FORGET. A floating promise on a serverless function
 * can be killed the moment the response is returned, which would drop the CI
 * silently and non-deterministically. Sequential awaits, never
 * prisma.$transaction (CORE §3).
 *
 * ⚠ HOOKED ON CONFIRM ONLY — never on findings/report. The trigger is the
 * SUPERVISOR's sign-off, a human action; a picker's unconfirmed claim must never
 * raise a document.
 */
async function raiseAutoCi(
  order: CiAutoOrder,
  supervisorId: number,
  // Only for the log line — a merged row's save covers several raw lines.
  rawLineItemIds: readonly number[],
): Promise<void> {
  try {
    await reconcileAutoCi(order, supervisorId);
  } catch (err) {
    const which =
      rawLineItemIds.length === 1 ? `line ${rawLineItemIds[0]}` : `lines ${rawLineItemIds.join(", ")}`;
    console.error(
      `[picking/findings/confirm] auto-CI reconcile FAILED for order #${order.id} ` +
        `/ OBD ${order.obdNumber} (${which}). The finding IS saved; the ` +
        `CI is not. Raise it by hand from /ci if goods came back:`,
      err,
    );
  }
}

