import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

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
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN]);

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

  if (order.workflowStage !== "pending_support") {
    return err(
      "PAST_TINT",
      "This OBD has moved past the support stage and cannot be pulled into tinting",
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
