import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { FLOOR_HOLD_NOTE } from "@/lib/floor/hold-log";

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
      // Set by 'cancel' only — see the write block below. Declared here rather
      // than inside the branch because the writes are shared by all five
      // actions and must stay in ONE place.
      let clearAssignment = false;

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
        // (CLAUDE_FLOOR.md §4.5 — the read-side rule; convention inherited from
        // the retired Support board). Same convention every hold path uses.
        updateData = { dispatchStatus: "hold", heldAt: order.obdEmailDate ?? new Date() };
        // The note is the ONLY thing that identifies this as a hold event —
        // toStage deliberately stays the order's unchanged workflowStage. Shared
        // constant with the reader (getFloorHold) so the two cannot drift.
        note = FLOOR_HOLD_NOTE;
      } else if (action === "cancel") {
        if (order.workflowStage === "cancelled") {
          failed.push({ orderId, error: "Already cancelled" });
          continue;
        }
        updateData = { workflowStage: "cancelled", dispatchStatus: null };
        toStage = "cancelled";
        note = body.reason ? `Cancelled — ${body.reason}` : "Cancelled from floor";
        // 🔴 ORPHAN FIX (2026-08-20). Cancel is NOT stage-gated here — it will
        // happily kill a bill sitting at pick_assigned / pick_done /
        // pick_checked — and until now it left the pick_assignments row behind,
        // because this branch only ever wrote to `orders`.
        //
        // That row is a trap, not just litter. A cancelled bill can be Restored
        // (the 'restore' arm below) to pending_support, then Released to
        // pending_picking — at which point app/api/picking/assign/route.ts's
        // guard (c) finds the surviving row and rejects with "Already
        // assigned." FOREVER: `pick_assignments.orderId` is @unique and the
        // ONLY deleter is app/api/picking/unassign/route.ts, which requires
        // workflowStage === PICK_ASSIGNED — a stage the bill can never reach
        // again. The bill is permanently un-assignable while the UI claims it
        // is assigned to nobody.
        //
        // Clearing it also stops the row asserting a false present tense: once
        // the order is dead, "Ramesh is picking this" is not true. Who held it
        // survives on the assign event in order_status_logs, which is the right
        // home for history.
        clearAssignment = true;
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
      // Cancel only — clear the assignment AFTER the stage write, never before.
      // Same ordering rule as app/api/picking/unassign/route.ts: if this fails,
      // the order is cancelled with a stale row (a fixable leftover, and the
      // state every cancel produced before this fix). Reversed, a failed stage
      // write would delete the assignment record while the bill was still
      // pick_assigned — on the picker's board with no record of who has it, and
      // unrecoverable via unassign. deleteMany tolerates the common case of no
      // row at all. Touches neither `orders` nor `order_status_logs`, so the
      // one-update / one-log contract above is unchanged and the live-sync
      // marker sees exactly one change.
      if (clearAssignment) {
        await prisma.pick_assignments.deleteMany({ where: { orderId } });
      }
      // ONE log per bill per action.
      await prisma.order_status_logs.create({
        data: { orderId, fromStage: order.workflowStage, toStage, changedById, note },
      });

      done.push(orderId);
    } catch (err) {
      failed.push({ orderId, error: err instanceof Error ? err.message : "Unexpected error" });
    }
  }

  // Nothing changed at all → 422 so a fully-skipped action cannot be read as
  // success by the client. A partial success stays 200 but always carries the
  // `failed` list to be surfaced (the swallowed-response bug this closes).
  const status = done.length === 0 && failed.length > 0 ? 422 : 200;
  return NextResponse.json({ done, failed }, { status });
}
