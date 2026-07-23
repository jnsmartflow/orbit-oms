import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Floor Control — bulk + single actions on floor/rail bills (design §7.8-§7.11,
// §9). NOT assignment: Assign/Unassign go through the existing Picking endpoints
// unchanged (see components/floor/floor-page.tsx). This route owns the five
// state actions below.
//
// Contract per bill, non-negotiable (CORE §3 + CLAUDE_PICKING §10):
//   - sequential awaits, never prisma.$transaction
//   - exactly ONE orders.update per bill (a second write fires a false "changed"
//     on every board's updatedAt live-sync marker)
//   - exactly ONE order_status_logs row per bill per action

type FloorAction = "mark-urgent" | "change-slot" | "hold" | "cancel" | "restore";
const ACTIONS: FloorAction[] = ["mark-urgent", "change-slot", "hold", "cancel", "restore"];

interface Body {
  action?: FloorAction;
  orderIds?: number[];
  urgent?: boolean; // mark-urgent: explicit set (bar). Omitted → per-bill toggle (row ⚡).
  dispatchTargetDate?: string; // change-slot: YYYY-MM-DD
  dispatchWindowId?: number; // change-slot
  reason?: string; // cancel: optional log note
}

interface Failed {
  orderId: number;
  error: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseDateOnly(s: string): Date | null {
  if (!DATE_RE.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10) === s ? dt : null;
}

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const changedById = Number(session.user.id);
  if (!Number.isInteger(changedById) || changedById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const action = body.action;
  if (!action || !ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Unknown or missing action" }, { status: 400 });
  }

  const orderIds = body.orderIds;
  if (!Array.isArray(orderIds) || orderIds.length === 0 || !orderIds.every((id) => typeof id === "number" && Number.isInteger(id))) {
    return NextResponse.json({ error: "orderIds is required and must be a non-empty array of integers" }, { status: 400 });
  }

  // change-slot needs a valid date + window up front; resolve window labels once.
  let slotDate: Date | null = null;
  let windowLabel = "";
  if (action === "change-slot") {
    if (typeof body.dispatchWindowId !== "number" || !Number.isInteger(body.dispatchWindowId)) {
      return NextResponse.json({ error: "dispatchWindowId is required for change-slot" }, { status: 400 });
    }
    slotDate = typeof body.dispatchTargetDate === "string" ? parseDateOnly(body.dispatchTargetDate) : null;
    if (!slotDate) {
      return NextResponse.json({ error: "dispatchTargetDate (YYYY-MM-DD) is required for change-slot" }, { status: 400 });
    }
    const win = await prisma.dispatch_slot_master.findUnique({ where: { id: body.dispatchWindowId }, select: { windowTime: true } });
    if (!win) return NextResponse.json({ error: "dispatchWindowId does not resolve to a window" }, { status: 400 });
    windowLabel = win.windowTime;
  }

  const done: number[] = [];
  const failed: Failed[] = [];

  for (const orderId of orderIds) {
    try {
      const order = await prisma.orders.findUnique({
        where: { id: orderId },
        select: { id: true, workflowStage: true, priorityLevel: true, obdEmailDate: true, dispatchStatus: true, isRemoved: true },
      });
      if (!order || order.isRemoved) {
        failed.push({ orderId, error: "Order not found" });
        continue;
      }

      // Unchecked update input so scalar FK writes (dispatchWindowId) are typed —
      // same shape the release route builds inline (CORE §3, no relation churn).
      let updateData: Prisma.ordersUncheckedUpdateInput;
      let toStage = order.workflowStage;
      let note: string;

      if (action === "mark-urgent") {
        const newLevel = typeof body.urgent === "boolean" ? (body.urgent ? 1 : 3) : order.priorityLevel === 1 ? 3 : 1;
        updateData = { priorityLevel: newLevel };
        note = newLevel === 1 ? "Marked urgent (P1)" : "Cleared urgent";
      } else if (action === "change-slot") {
        updateData = { dispatchTargetDate: slotDate, dispatchWindowId: body.dispatchWindowId, dispatchSlotSource: "manual" };
        note = `Dispatch slot changed to ${body.dispatchTargetDate} ${windowLabel}`;
      } else if (action === "hold") {
        if (order.workflowStage === "cancelled") {
          failed.push({ orderId, error: "Cannot hold a cancelled bill" });
          continue;
        }
        // heldAt anchors the hold footprint to the ARRIVAL date, not wall-clock
        // (CLAUDE_SUPPORT §4.9 / §5). Same convention every hold path uses.
        updateData = { dispatchStatus: "hold", heldAt: order.obdEmailDate ?? new Date() };
        note = "Held from floor";
      } else if (action === "cancel") {
        if (order.workflowStage === "cancelled") {
          failed.push({ orderId, error: "Already cancelled" });
          continue;
        }
        updateData = { workflowStage: "cancelled", dispatchStatus: null };
        toStage = "cancelled";
        note = body.reason ? `Cancelled — ${body.reason}` : "Cancelled from floor";
      } else {
        // restore — cancelled → back onto the left rail as an undecided card
        // (design §9). pending_support (rank 50) satisfies the rail predicate
        // (getFloorRail: rank < 60 + dispatchStatus null). Splits were never
        // touched by cancel, so nothing to reset here.
        if (order.workflowStage !== "cancelled") {
          failed.push({ orderId, error: "Order is not cancelled" });
          continue;
        }
        updateData = { workflowStage: "pending_support", dispatchStatus: null };
        toStage = "pending_support";
        note = "Restored to decisions";
      }

      // ONE orders.update per bill.
      await prisma.orders.update({ where: { id: orderId }, data: updateData });
      // ONE log per bill per action.
      await prisma.order_status_logs.create({
        data: { orderId, fromStage: order.workflowStage, toStage, changedById, note },
      });

      done.push(orderId);
    } catch (err) {
      failed.push({ orderId, error: err instanceof Error ? err.message : "Unexpected error" });
    }
  }

  return NextResponse.json({ done, failed });
}
