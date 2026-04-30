import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type ErrorCode =
  | "BAD_REQUEST"
  | "INVALID_REASON"
  | "REASON_NOTES_REQUIRED"
  | "NOT_FOUND"
  | "ALREADY_TINT"
  | "PAST_TINT"
  | "TOO_OLD"
  | "INVALID_SMU"
  | "INVALID_LINES"
  | "INACTIVE_ORDER"
  | "INTERNAL_ERROR";

const ELIGIBLE_SMUS = ["Retail Offtake", "Decorative Projects"];
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const VALID_REASONS = [
  "sample",
  "custom_shade",
  "late_addition",
  "classification_miss",
  "other",
] as const;
type ReasonCode = (typeof VALID_REASONS)[number];

function err(code: ErrorCode, message: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, errorCode: code, message }, { status });
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN]);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err("BAD_REQUEST", "Invalid JSON body", 400);
  }

  if (!body || typeof body !== "object") {
    return err("BAD_REQUEST", "Body must be an object", 400);
  }

  const {
    orderId,
    lineIds,
    reasonCode,
    reasonNotes,
  } = body as {
    orderId?:     unknown;
    lineIds?:     unknown;
    reasonCode?:  unknown;
    reasonNotes?: unknown;
  };

  if (!isPositiveInt(orderId)) {
    return err("BAD_REQUEST", "orderId must be a positive integer", 400);
  }

  if (
    !Array.isArray(lineIds) ||
    lineIds.length < 1 ||
    !lineIds.every(isPositiveInt)
  ) {
    return err(
      "BAD_REQUEST",
      "lineIds must be a non-empty array of positive integers",
      400,
    );
  }

  if (typeof reasonCode !== "string" || !VALID_REASONS.includes(reasonCode as ReasonCode)) {
    return err(
      "INVALID_REASON",
      `reasonCode must be one of: ${VALID_REASONS.join(", ")}`,
      400,
    );
  }

  if (reasonNotes !== undefined && reasonNotes !== null && typeof reasonNotes !== "string") {
    return err("BAD_REQUEST", "reasonNotes must be a string when provided", 400);
  }

  const trimmedNotes =
    typeof reasonNotes === "string" ? reasonNotes.trim() : "";

  if (reasonCode === "other" && trimmedNotes.length === 0) {
    return err(
      "REASON_NOTES_REQUIRED",
      "reasonNotes is required when reasonCode is 'other'",
      400,
    );
  }

  const order = await prisma.orders.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    return err("NOT_FOUND", `No order found with id ${orderId}`, 404);
  }

  if (!order.isActive) {
    return err("INACTIVE_ORDER", "This order is inactive and cannot be modified", 400);
  }

  if (order.orderType !== "non_tint") {
    return err("ALREADY_TINT", "This OBD is already in the tint workflow", 400);
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
      "This OBD's date is outside the eligible window (must be within the last 7 days)",
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

  // Validate that all lineIds belong to this order's OBD and are valid rows.
  const matchingLines = await prisma.import_raw_line_items.findMany({
    where: {
      id:        { in: lineIds },
      obdNumber: order.obdNumber,
      rowStatus: "valid",
    },
    select: { id: true },
  });

  if (matchingLines.length !== lineIds.length) {
    return err(
      "INVALID_LINES",
      "One or more lineIds do not belong to this OBD or are not valid rows",
      400,
    );
  }

  const performedById = parseInt(session!.user.id, 10);
  if (isNaN(performedById)) {
    return err("INTERNAL_ERROR", "Invalid session user id", 500);
  }

  const reasonNotesValue = trimmedNotes.length > 0 ? trimmedNotes : null;

  try {
    // Step A — flip line items to tinting
    await prisma.import_raw_line_items.updateMany({
      where: { id: { in: lineIds } },
      data:  { isTinting: true },
    });

    // Step B — set hasTinting on the OBD query summary (defensive: row may be missing)
    try {
      await prisma.import_obd_query_summary.update({
        where: { orderId: order.id },
        data:  { hasTinting: true },
      });
    } catch (qsErr) {
      console.warn(
        `[manual-entry] No import_obd_query_summary for orderId=${order.id} — skipping hasTinting update`,
        qsErr,
      );
    }

    // Step C — flip order into the tint workflow
    await prisma.orders.update({
      where: { id: order.id },
      data: {
        orderType:       "tint",
        workflowStage:   "pending_tint_assignment",
        manualTintEntry: true,
        slotId:          null,
        originalSlotId:  null,
        dispatchSlot:    null,
      },
    });

    // Step D — write order_status_logs audit row
    await prisma.order_status_logs.create({
      data: {
        orderId:     order.id,
        fromStage:   "pending_support",
        toStage:     "pending_tint_assignment",
        changedById: performedById,
        note:
          `Manual tint pull: ${reasonCode}` +
          (reasonNotesValue ? ` — ${reasonNotesValue}` : ""),
      },
    });

    // Step E — write manual_tint_entries audit row
    await prisma.manual_tint_entries.create({
      data: {
        orderId:       order.id,
        action:        "pulled_in",
        reasonCode:    reasonCode as ReasonCode,
        reasonNotes:   reasonNotesValue,
        lineIds:       lineIds as number[],
        performedById,
      },
    });

    // Step F — ensure delivery challan exists (eligible SMU already validated)
    // Wrapped in try/catch: failure here does NOT roll back the manual pull.
    // Steps A-E already succeeded; a missing challan can be created later.
    try {
      const existingChallan = await prisma.delivery_challans.findUnique({
        where: { orderId: order.id },
        select: { id: true },
      });

      if (!existingChallan) {
        const lastChallan = await prisma.delivery_challans.findFirst({
          orderBy: { id: "desc" },
          select: { challanNumber: true },
        });

        let nextSeq = 1;
        if (lastChallan?.challanNumber) {
          const parts   = lastChallan.challanNumber.split("-");
          const lastNum = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(lastNum)) nextSeq = lastNum + 1;
        }

        const year          = new Date().getFullYear();
        const challanNumber = `CHN-${year}-${String(nextSeq).padStart(5, "0")}`;

        await prisma.delivery_challans.create({
          data: {
            orderId:       order.id,
            challanNumber,
          },
        });
      }
    } catch (challanErr) {
      console.warn(
        `[manual-entry] Step F challan ensure failed for orderId=${order.id} — non-fatal, manual pull already committed`,
        challanErr,
      );
    }

    return NextResponse.json({
      ok: true,
      order: {
        id:            order.id,
        obdNumber:     order.obdNumber,
        workflowStage: "pending_tint_assignment",
      },
    });
  } catch (e) {
    console.error("[manual-entry POST] Failed to apply manual tint pull:", {
      orderId: order.id,
      lineIds,
      reasonCode,
      error: e,
    });
    return err("INTERNAL_ERROR", "Failed to apply manual tint pull", 500);
  }
}
