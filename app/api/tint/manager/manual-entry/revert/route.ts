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
  | "NOT_MANUAL"
  | "ALREADY_PROGRESSED"
  | "ALREADY_ASSIGNED"
  | "TI_ALREADY_RECORDED"
  | "ALREADY_SPLIT"
  | "PULL_RECORD_MISSING"
  | "INTERNAL_ERROR";

const VALID_REVERT_REASONS = ["classification_miss", "other"] as const;
type RevertReasonCode = (typeof VALID_REVERT_REASONS)[number];

function err(code: ErrorCode, message: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, errorCode: code, message }, { status });
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

// Mirrors resolveSlot from app/api/import/obd/route.ts.
// Time-based slot assignment, IST. See CLAUDE_CORE.md §9.
function resolveSlot(
  emailTime: string | null,
): { dispatchSlot: string; slotId: number } {
  if (!emailTime)          return { dispatchSlot: "Night",     slotId: 4 };
  if (emailTime < "10:30") return { dispatchSlot: "Morning",   slotId: 1 };
  if (emailTime < "12:30") return { dispatchSlot: "Afternoon", slotId: 2 };
  if (emailTime < "15:30") return { dispatchSlot: "Evening",   slotId: 3 };
  return { dispatchSlot: "Night", slotId: 4 };
}

// Convert UTC Date to IST "HH:MM" string for resolveSlot.
function istTimeFromDate(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  const hh = String(ist.getUTCHours()).padStart(2, "0");
  const mm = String(ist.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
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

  const { orderId, reasonCode, reasonNotes } = body as {
    orderId?:     unknown;
    reasonCode?:  unknown;
    reasonNotes?: unknown;
  };

  if (!isPositiveInt(orderId)) {
    return err("BAD_REQUEST", "orderId must be a positive integer", 400);
  }

  if (
    typeof reasonCode !== "string" ||
    !VALID_REVERT_REASONS.includes(reasonCode as RevertReasonCode)
  ) {
    return err(
      "INVALID_REASON",
      `reasonCode must be one of: ${VALID_REVERT_REASONS.join(", ")}`,
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

  if (!order.manualTintEntry) {
    return err(
      "NOT_MANUAL",
      "This order was not pulled in via manual tint entry",
      400,
    );
  }

  if (order.workflowStage !== "pending_tint_assignment") {
    return err(
      "ALREADY_PROGRESSED",
      "This order has already progressed past pending_tint_assignment and cannot be reverted",
      400,
    );
  }

  const assignmentCount = await prisma.tint_assignments.count({
    where: { orderId: order.id },
  });
  if (assignmentCount > 0) {
    return err(
      "ALREADY_ASSIGNED",
      "This order has already been assigned to a tint operator and cannot be reverted",
      400,
    );
  }

  const tinterEntryCount = await prisma.tinter_issue_entries.count({
    where: { orderId: order.id },
  });
  if (tinterEntryCount > 0) {
    return err(
      "TI_ALREADY_RECORDED",
      "Tinter Issue entries already recorded for this order — cannot revert",
      400,
    );
  }

  const splitCount = await prisma.order_splits.count({
    where: { orderId: order.id },
  });
  if (splitCount > 0) {
    return err(
      "ALREADY_SPLIT",
      "This order has already been split — cannot revert",
      400,
    );
  }

  const performedById = parseInt(session!.user.id, 10);
  if (isNaN(performedById)) {
    return err("INTERNAL_ERROR", "Invalid session user id", 500);
  }

  const reasonNotesValue = trimmedNotes.length > 0 ? trimmedNotes : null;
  let pulledLineIds: number[] = [];

  try {
    // Step A — recover the lineIds from the most recent 'pulled_in' audit row
    const pulledIn = await prisma.manual_tint_entries.findFirst({
      where:   { orderId: order.id, action: "pulled_in" },
      orderBy: { createdAt: "desc" },
    });

    if (!pulledIn) {
      console.error(
        `[manual-entry revert] manualTintEntry=true but no pulled_in audit row for orderId=${order.id}`,
      );
      return err(
        "PULL_RECORD_MISSING",
        "Could not find the original manual pull record — contact support",
        500,
      );
    }

    pulledLineIds = pulledIn.lineIds;

    // Step B — un-flip the previously pulled lines
    await prisma.import_raw_line_items.updateMany({
      where: { id: { in: pulledLineIds } },
      data:  { isTinting: false },
    });

    // Step C — recompute hasTinting defensively for this OBD
    const remainingTintingLines = await prisma.import_raw_line_items.count({
      where: {
        obdNumber:  order.obdNumber,
        rowStatus:  "valid",
        isTinting:  true,
        lineStatus: "active",
      },
    });

    try {
      await prisma.import_obd_query_summary.update({
        where: { orderId: order.id },
        data:  { hasTinting: remainingTintingLines > 0 },
      });
    } catch (qsErr) {
      console.warn(
        `[manual-entry revert] No import_obd_query_summary for orderId=${order.id} — skipping hasTinting recompute`,
        qsErr,
      );
    }

    // Step D — restore non-tint workflow + slot assignment from orderDateTime
    const istTime = order.orderDateTime ? istTimeFromDate(order.orderDateTime) : null;
    const { dispatchSlot, slotId } = resolveSlot(istTime);

    await prisma.orders.update({
      where: { id: order.id },
      data: {
        orderType:       "non_tint",
        workflowStage:   "pending_support",
        manualTintEntry: false,
        slotId,
        originalSlotId:  slotId,
        dispatchSlot,
      },
    });

    // Step E — write order_status_logs audit row
    await prisma.order_status_logs.create({
      data: {
        orderId:     order.id,
        fromStage:   "pending_tint_assignment",
        toStage:     "pending_support",
        changedById: performedById,
        note:
          `Manual tint reverted: ${reasonCode}` +
          (reasonNotesValue ? ` — ${reasonNotesValue}` : ""),
      },
    });

    // Step F — write manual_tint_entries audit row (action='reverted')
    await prisma.manual_tint_entries.create({
      data: {
        orderId:       order.id,
        action:        "reverted",
        reasonCode:    reasonCode as RevertReasonCode,
        reasonNotes:   reasonNotesValue,
        lineIds:       pulledLineIds,
        performedById,
      },
    });

    return NextResponse.json({
      ok: true,
      order: {
        id:            order.id,
        obdNumber:     order.obdNumber,
        workflowStage: "pending_support",
      },
    });
  } catch (e) {
    console.error("[manual-entry revert] Failed to apply revert:", {
      orderId: order.id,
      lineIds: pulledLineIds,
      reasonCode,
      error: e,
    });
    return err("INTERNAL_ERROR", "Failed to apply manual tint revert", 500);
  }
}
