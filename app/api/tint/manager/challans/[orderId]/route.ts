import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";
import { loadChallanDetail } from "@/lib/tint/challan-detail";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { orderId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The Delivery Challans tick (2026-10-09; was tint_manager canView since
  // 2026-09-06). The screen at /tint/manager/challan is gated on the same key.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "delivery_challans", "canView");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const orderId = parseInt(params.orderId, 10);
  if (isNaN(orderId)) {
    return NextResponse.json({ error: "Invalid orderId" }, { status: 400 });
  }

  // The read itself lives in lib/tint/challan-detail.ts (2026-10-09) — shared
  // with the print-only page Floor's DC column uses. Same JSON, same codes.
  const result = await loadChallanDetail(orderId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH — save transporter, vehicleNo, formulas, printedAt/printedBy
// ─────────────────────────────────────────────────────────────────────────────

interface FormulaItem {
  rawLineItemId: number;
  formula: string;
}

interface PatchBody {
  transporter?: string;
  vehicleNo?:   string;
  formulas?:    FormulaItem[];
  printedAt?:   string;
  printedBy?:   number;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { orderId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The Delivery Challans tick, canEdit (2026-10-09; was tint_manager canEdit).
  // Challan authority is now its own key, separate from board authority. The
  // screen draws Edit/Save from the same canEdit (challan/page.tsx).
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "delivery_challans", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const orderId = parseInt(params.orderId, 10);
  if (isNaN(orderId)) {
    return NextResponse.json({ error: "Invalid orderId" }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { transporter, vehicleNo, formulas, printedAt, printedBy } = body;

  try {
    // ── 1. Confirm the challan row exists + check void state ──────────────────
    // Voided challans are read-only (UI shows banner). Reject write attempts
    // with 409 — caller must restore the order first to un-void the challan.
    // The four scalar columns are NEW in this select (2026-09-06) and exist only
    // to give the audit call at the end a before-image. Widening the read this
    // route already does beats adding a second one.
    const challan = await prisma.delivery_challans.findUnique({
      where:  { orderId },
      select: {
        id: true, orderId: true, isVoided: true, challanNumber: true,
        transporter: true, vehicleNo: true, printedAt: true, printedBy: true,
      },
    });

    if (!challan) {
      return NextResponse.json(
        { error: "Challan not found. Open the GET endpoint first to auto-create it." },
        { status: 404 },
      );
    }
    if (challan.isVoided) {
      return NextResponse.json(
        { ok: false, error: "Cannot modify a voided challan" },
        { status: 409 },
      );
    }

    // ── 2. Validate formula rawLineItemIds — isTinting = true only ────────────
    if (formulas && formulas.length > 0) {
      const requestedIds = formulas.map((f) => f.rawLineItemId);

      // Fetch the order's obdNumber so we can filter by it
      const orderRow = await prisma.orders.findFirst({
        where:  { id: orderId, isRemoved: false },
        select: { obdNumber: true },
      });

      if (!orderRow) {
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      }

      const tintingLines = await prisma.import_raw_line_items.findMany({
        where: {
          id:         { in: requestedIds },
          obdNumber:  orderRow.obdNumber,
          isTinting:  true,
          lineStatus: "active",
        },
        select: { id: true },
      });

      const validIds = new Set(tintingLines.map((l) => l.id));
      const invalid  = requestedIds.filter((id) => !validIds.has(id));

      if (invalid.length > 0) {
        return NextResponse.json(
          {
            error:   "Formula may only be set on tinting lines",
            invalid: invalid,
          },
          { status: 400 },
        );
      }
    }

    // ── 3. Build the challan update payload ───────────────────────────────────
    const challanUpdate: {
      transporter?: string;
      vehicleNo?:   string;
      printedAt?:   Date;
      printedBy?:   number;
    } = {};

    if (transporter !== undefined) challanUpdate.transporter = transporter;
    if (vehicleNo   !== undefined) challanUpdate.vehicleNo   = vehicleNo;
    if (printedAt   !== undefined) challanUpdate.printedAt   = new Date(printedAt);
    if (printedBy   !== undefined) challanUpdate.printedBy   = printedBy;

    // ── 4. Run all writes in a transaction ────────────────────────────────────
    const updated = await prisma.$transaction(async (tx) => {
      // 4a. Update delivery_challans (updatedAt is @updatedAt — Prisma sets it)
      const updatedChallan = await tx.delivery_challans.update({
        where: { id: challan.id },
        data:  challanUpdate,
      });

      // 4b. Upsert each formula — ON CONFLICT (challanId, rawLineItemId)
      if (formulas && formulas.length > 0) {
        for (const item of formulas) {
          await tx.delivery_challan_formulas.upsert({
            where: {
              challanId_rawLineItemId: {
                challanId:     challan.id,
                rawLineItemId: item.rawLineItemId,
              },
            },
            update: {
              formula:              item.formula,
              isManuallyOverridden: true,
              autoFilledAt:         null,
              sourceTiEntryId:      null,
            },
            create: {
              challanId:            challan.id,
              rawLineItemId:        item.rawLineItemId,
              formula:              item.formula,
              isManuallyOverridden: true,
              autoFilledAt:         null,
              sourceTiEntryId:      null,
            },
          });
        }
      }

      return updatedChallan;
    });

    // ── 4c. Audit ─────────────────────────────────────────────────────────────
    // AFTER the write returns and deliberately OUTSIDE the $transaction above —
    // adding the call inside would change that transaction's shape, and CORE §13
    // records it as pre-existing and not to be extended. Audit RULE 1 means a
    // failed log cannot roll the challan save back; RULE 2 means it runs only
    // once the save has actually succeeded.
    //
    // Formula upserts are counted, not enumerated: a challan can carry a dozen
    // tinting lines, the live formula is always readable on the challan itself,
    // and the audit-worthy fact is that the manager overrode N of them by hand.
    const changed: string[] = [];
    const beforeData: Record<string, unknown> = {};
    const afterData:  Record<string, unknown> = {};
    for (const k of ["transporter", "vehicleNo", "printedBy"] as const) {
      if (challan[k] !== updated[k]) {
        changed.push(k);
        beforeData[k] = challan[k];
        afterData[k]  = updated[k];
      }
    }
    const printedBefore = challan.printedAt?.toISOString() ?? null;
    const printedAfter  = updated.printedAt?.toISOString() ?? null;
    if (printedBefore !== printedAfter) {
      changed.push("printedAt");
      beforeData.printedAt = printedBefore;
      afterData.printedAt  = printedAfter;
    }
    const formulaCount = formulas?.length ?? 0;
    if (formulaCount > 0) changed.push(`${formulaCount} formula(s)`);

    if (changed.length > 0) {
      await logAdminAction({
        userId:   parseInt(session!.user.id, 10),
        entity:   "delivery_challans",
        entityId: String(challan.id),
        action:   "update",
        summary:  `challan ${updated.challanNumber} (OBD order ${orderId}) — ${changed.join(", ")}`,
        before:   beforeData,
        after:    afterData,
      });
    }

    // ── 5. Return updated challan row ─────────────────────────────────────────
    return NextResponse.json({
      id:            updated.id,
      orderId:       updated.orderId,
      challanNumber: updated.challanNumber,
      transporter:   updated.transporter  ?? null,
      vehicleNo:     updated.vehicleNo    ?? null,
      printedAt:     updated.printedAt?.toISOString()  ?? null,
      printedBy:     updated.printedBy    ?? null,
      createdAt:     updated.createdAt.toISOString(),
      updatedAt:     updated.updatedAt.toISOString(),
    });

  } catch (err) {
    console.error("[tint/manager/challans/[orderId] PATCH] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
