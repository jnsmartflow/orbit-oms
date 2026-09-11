import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { MANUAL_TINT_PULLABLE_STAGES } from "@/lib/workflow-stages";

export const dynamic = "force-dynamic";

type ErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "ALREADY_TINT"
  | "PAST_TINT"
  | "TOO_OLD"
  | "INVALID_SMU";

const ELIGIBLE_SMUS = ["Retail Offtake", "Decorative Projects"];
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function err(code: ErrorCode, message: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, errorCode: code, message }, { status });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user tick, not a job title (2026-09-06).
  //
  // 🔴 THIS GATE MUST NOT BE NARROWER THAN THE POST IT FEEDS. The manual-entry
  // modal calls THIS route first (manual-tint-entry-modal.tsx:150) and only then
  // POSTs to ../manual-entry (:188). When 64f897a9 widened the POST to
  // tint_manager/canEdit it left this GET on requireRole([TINT_MANAGER, ADMIN]),
  // so Prakash (operation_manager) held the write and was refused the read —
  // and the failure was invisible: requireRole redirects 307, fetch follows it
  // to an HTML page, res.json() throws, and the modal's own catch at :168
  // swallowed it into an empty box. canView rather than canEdit because this
  // route only reads; the holder sets are identical today and the POST beside it
  // is the thing that decides whether an entry may actually be made.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "tint_manager", "canView");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const obdRaw = req.nextUrl.searchParams.get("obd");
  const obd = (obdRaw ?? "").trim();
  if (!obd) {
    return err("BAD_REQUEST", "Missing 'obd' query parameter", 400);
  }

  const order = await prisma.orders.findFirst({
    where: { obdNumber: obd, isRemoved: false },
    include: {
      customer: { select: { customerName: true } },
    },
  });

  if (!order) {
    return err("NOT_FOUND", `No order found for OBD ${obd}`, 404);
  }

  if (order.orderType !== "non_tint") {
    return err(
      "ALREADY_TINT",
      "This OBD is already in the tint workflow",
      400,
    );
  }

  // ── WIDENED 2026-09-11 ─────────────────────────────────────────────────────
  // 🔴 THIS READ `!== "pending_support"` AND WOULD HAVE BROKEN THE WHOLE SCREEN.
  // From today a non-tint bill is released to `pending_picking` the moment it is
  // imported (the no-mail-order fallback in app/api/import/obd/route.ts), so
  // almost NO bill is at `pending_support` any more and manual tint entry would
  // have found nothing to pull in.
  //
  // ⚠ THE REAL QUESTION THIS GUARD ASKS IS "HAS A PICKER TOUCHED IT YET", and
  // `pending_support` was only ever a proxy for that. Both stages below mean
  // nobody has: `pending_support` is the desk, `pending_picking` is on the floor
  // and waiting. Every later stage — pick_assigned, pick_done, pick_checked,
  // dispatched — means the material is off the shelf, and cancelled/closed mean
  // the bill is finished. All of those are still refused, which is the safety
  // this guard was actually providing.
  //
  // ⚠ STILL SAFE because the two checks above it do the heavy lifting: the bill
  // must exist and must be `orderType: "non_tint"`, so a bill already in the
  // tint workflow can never reach here whatever its stage.
  if (!MANUAL_TINT_PULLABLE_STAGES.includes(order.workflowStage)) {
    return err(
      "PAST_TINT",
      "This OBD has already been picked and cannot be pulled into tinting",
      400,
    );
  }

  if (!order.orderDateTime) {
    return err(
      "TOO_OLD",
      "This OBD has no order date — cannot determine eligibility",
      400,
    );
  }

  const ageMs = Date.now() - order.orderDateTime.getTime();
  if (ageMs < 0 || ageMs > SEVEN_DAYS_MS) {
    return err(
      "TOO_OLD",
      "This OBD's date is outside the eligible window (must be within the last 7 days)",
      400,
    );
  }

  if (!order.smu || !ELIGIBLE_SMUS.includes(order.smu)) {
    return err(
      "INVALID_SMU",
      "Tinting is only allowed for SMU 'Retail Offtake' or 'Decorative Projects'",
      400,
    );
  }

  const lines = await prisma.import_raw_line_items.findMany({
    where: {
      obdNumber:  order.obdNumber,
      rowStatus:  "valid",
      lineStatus: "active",
    },
    orderBy: { lineId: "asc" },
    select: {
      id:                true,
      lineId:            true,
      skuCodeRaw:        true,
      skuDescriptionRaw: true,
      unitQty:           true,
      volumeLine:        true,
      isTinting:         true,
    },
  });

  return NextResponse.json({
    ok: true,
    order: {
      id:            order.id,
      obdNumber:     order.obdNumber,
      customerName:  order.customer?.customerName ?? order.shipToCustomerName ?? null,
      smu:           order.smu,
      orderDateTime: order.orderDateTime.toISOString(),
      workflowStage: order.workflowStage,
      orderType:     order.orderType as "tint" | "non_tint",
      lines,
    },
  });
}
