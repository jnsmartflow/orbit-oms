import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { SUPPORT_DONE_OUTPUT } from "@/lib/workflow-stages";
import { setRowsTrip } from "@/lib/order-invoices/trip-link";
import { deleteTripDropIfEmpty } from "@/lib/trips/drop";
import { logTripBills } from "@/lib/trips/activity";
import { cancelledPickerFromNote } from "@/lib/tint/manual-pull-rules";

export const dynamic = "force-dynamic";

// ── WHERE A REVERTED BILL GOES (2026-10-24, Add to Tint server build) ────────
// Was: `pending_support` with a slot recomputed from the order time — the desk,
// which nothing reads any more (every non-tint bill is released on import,
// CLAUDE_IMPORT.md §2.1). Now:
//   - `pending_picking` (SUPPORT_DONE_OUTPUT) + dispatchStatus "dispatch" — the
//     Assign tab, waiting for a picker; or `pending_support` when the bill is
//     HELD (dispatchStatus "hold"): a revert never releases a held bill, the
//     same rule as a tint completion (CLAUDE_TINT.md §2).
//   - the SLOT is left as the pull left it: the legacy columns null, a
//     hand-set dispatch slot kept, an auto one already cleared.
//   - OFF ANY TRIP: a tint bill can be put on a trip while it waits; a revert
//     takes it off (setRowsTrip, the same one write), and an emptied stop goes.
//   - SAMPLE untouched — it is the bill's own mark, not the pull's.
//   - The pick a pull cancelled is NOT restored: the response names the picker
//     (read from the pull's status-log note) so the popup can say so.

type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return err("UNAUTHORIZED", "Unauthorized", 401);

  // Per-user tick, not a job title (2026-09-06). The old gate was the NARROW
  // [TINT_MANAGER, ADMIN] — every other manager route also named OPERATIONS and
  // OPERATION_MANAGER. Converting deliberately widens this to everyone holding
  // tint_manager/canEdit, which adds Prakash (operation_manager). Owner decision,
  // taken on gate report section 3 — do not re-narrow it.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "tint_manager", "canEdit");
  if (!allowed) return err("FORBIDDEN", "Permission denied", 403);

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

  const order = await prisma.orders.findFirst({
    where: { id: orderId, isRemoved: false },
    include: {
      // The trips the bill joined while it waited (see the header).
      invoices: { select: { tripDropId: true, tripDrop: { select: { tripId: true } } } },
      tripDrop: { select: { tripId: true } },
    },
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

    // Step D — back to the non-tint workflow (see the header for where). ONE
    // orders.update — through setRowsTrip when the bill is on a trip.
    const held    = order.dispatchStatus === "hold";
    const toStage = held ? "pending_support" : SUPPORT_DONE_OUTPUT;
    const revertData = {
      orderType:       "non_tint",
      workflowStage:   toStage,
      manualTintEntry: false,
      slotId:          null,
      originalSlotId:  null,
      dispatchSlot:    null,
      ...(held ? {} : { dispatchStatus: "dispatch" }),
    };
    const dropIds = new Map<number, number>(); // dropId → tripId
    for (const r of order.invoices) {
      if (r.tripDropId !== null && r.tripDrop !== null) dropIds.set(r.tripDropId, r.tripDrop.tripId);
    }
    if (order.tripDropId !== null && order.tripDrop !== null) dropIds.set(order.tripDropId, order.tripDrop.tripId);

    if (dropIds.size > 0) {
      await setRowsTrip(order.id, "all", null, {}, revertData);
      for (const dropId of Array.from(dropIds.keys())) await deleteTripDropIfEmpty(dropId);
      for (const tripId of Array.from(new Set(dropIds.values()))) {
        await logTripBills({
          tripId,
          actorId: performedById,
          direction: "remove",
          orderIds: [order.id],
          obdNumbers: [order.obdNumber],
        });
      }
    } else {
      await prisma.orders.update({ where: { id: order.id }, data: revertData });
    }

    // The pick the pull cancelled, if any — named for the popup, never restored.
    const pullLog = await prisma.order_status_logs.findFirst({
      where:   { orderId: order.id, note: { startsWith: "Manual tint pull:" } },
      orderBy: { id: "desc" },
      select:  { note: true },
    });
    const cancelledPickerName = cancelledPickerFromNote(pullLog?.note ?? null);

    // Step E — write order_status_logs audit row
    await prisma.order_status_logs.create({
      data: {
        orderId:     order.id,
        fromStage:   "pending_tint_assignment",
        toStage,
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
        workflowStage: toStage,
      },
      // "Pick not restored" — the picker the pull took the bill from, or null;
      // and how many trips the revert took the bill off.
      cancelledPickerName,
      tripsLeft: new Set(dropIds.values()).size,
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
