import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { FLOOR_HOLD_NOTE, FLOOR_CLEAR_HOLD_NOTE } from "@/lib/floor/hold-log";
import { FLOOR_CLEAR_HOLD_STAGES } from "@/lib/floor/release-stages";
import { buildCancelNote, type CancelReason } from "@/lib/picking/cancel-reasons";
import { FLOOR_REMARK_MAX, isFloorCancelReason, offFloorRefusal } from "@/lib/floor/off-floor";

export const dynamic = "force-dynamic";

// Floor Control — bulk + single actions on floor/rail bills (design §7.8-§7.11,
// §9). NOT assignment: Assign/Unassign go through the existing Picking endpoints
// unchanged (see components/floor/floor-page.tsx). This route owns the six
// state actions below.
//
// Contract per bill, non-negotiable (CORE §3 + CLAUDE_PICKING §10):
//   - sequential awaits, never prisma.$transaction
//   - exactly ONE orders.update per bill (a second write fires a false "changed"
//     on every board's updatedAt live-sync marker)
//   - exactly ONE order_status_logs row per bill per action

type FloorAction = "mark-urgent" | "change-slot" | "hold" | "cancel" | "restore" | "unhold";
const ACTIONS: FloorAction[] = ["mark-urgent", "change-slot", "hold", "cancel", "restore", "unhold"];

interface Body {
  action?: FloorAction;
  orderIds?: number[];
  urgent?: boolean; // mark-urgent: explicit set (bar). Omitted → per-bill toggle (row ⚡).
  dispatchTargetDate?: string; // change-slot: YYYY-MM-DD
  dispatchWindowId?: number; // change-slot
  reason?: string; // cancel: legacy free-text note, used only when reasonKey is absent
  reasonKey?: string; // cancel: one of FLOOR_CANCEL_REASONS (lib/floor/off-floor.ts)
  remark?: string; // cancel: optional, ≤ FLOOR_REMARK_MAX, goes after the reason label
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

  // cancel: a reason KEY, when sent, is validated once up front — a bad value is
  // a clean 400, never a note recording a reason nobody chose. Absent means the
  // legacy note (the detail panel sends none until the 5b form lands).
  let cancelReason: CancelReason | null = null;
  let cancelRemark: string | null = null;
  if (action === "cancel") {
    if (body.reasonKey !== undefined) {
      if (!isFloorCancelReason(body.reasonKey)) {
        return NextResponse.json({ error: `Unknown cancel reason "${String(body.reasonKey)}"` }, { status: 400 });
      }
      cancelReason = body.reasonKey;
    }
    if (body.remark !== undefined && body.remark !== null) {
      if (typeof body.remark !== "string") {
        return NextResponse.json({ error: "remark must be a string" }, { status: 400 });
      }
      const trimmed = body.remark.trim();
      if (trimmed.length > FLOOR_REMARK_MAX) {
        return NextResponse.json({ error: `remark is longer than ${FLOOR_REMARK_MAX} characters` }, { status: 400 });
      }
      cancelRemark = trimmed === "" ? null : trimmed;
    }
  }

  const done: number[] = [];
  const failed: Failed[] = [];

  for (const orderId of orderIds) {
    try {
      const order = await prisma.orders.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          workflowStage: true,
          priorityLevel: true,
          obdEmailDate: true,
          dispatchStatus: true,
          isRemoved: true,
          // cancel's refusals (offFloorRefusal) — the trip number is for the message.
          tripDropId: true,
          tripDrop: { select: { trip: { select: { tripNumber: true } } } },
        },
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
      // than inside the branch because the writes are shared by all six
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
        // 🔴 THE SAME REFUSALS AS RAISE CI (lib/floor/off-floor.ts, owner
        // 2026-09-22): already cancelled, dispatched, on a trip, or in the tint
        // room. Per bill, into `failed`, never the whole batch.
        const refusal = offFloorRefusal({
          workflowStage: order.workflowStage,
          tripDropId: order.tripDropId,
          tripNumber: order.tripDrop?.trip.tripNumber ?? null,
        });
        if (refusal !== null) {
          failed.push({ orderId, error: refusal });
          continue;
        }
        updateData = { workflowStage: "cancelled", dispatchStatus: null };
        toStage = "cancelled";
        // With a reason key: Picking's note builder, so the Cancelled tab reads
        // "Cancelled — Pick delete · {remark}" exactly as a picking cancel does.
        note =
          cancelReason !== null
            ? buildCancelNote(cancelReason, cancelRemark)
            : body.reason
              ? `Cancelled — ${body.reason}`
              : "Cancelled from floor";
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
      } else if (action === "restore") {
        // restore — cancelled → back onto the board as a `no slot` row, through
        // floorBoardWhere's arm 2 (floorUnslottedWhere: rank < 60 +
        // dispatchStatus null; the decision rail this once fed retired
        // 2026-09-13). Splits were never touched by cancel, so nothing to reset.
        if (order.workflowStage !== "cancelled") {
          failed.push({ orderId, error: "Order is not cancelled" });
          continue;
        }
        // 🔴 A BILL WITH A LIVE CI IS NOT RESTORED (2026-09-22). Its return is on
        // billing's desk; putting it back on the floor would send the goods out
        // while billing books them back in. ANY source — a floor CI, a hand-raised
        // one, an auto one. A draft is an in-flight write, invisible everywhere
        // (CLAUDE_CI §2), and does not count.
        const liveCi = await prisma.ci_returns.findFirst({
          where: { orderId, isVoided: false, status: { not: "draft" } },
          orderBy: { id: "asc" },
          select: { id: true, ciNumber: true },
        });
        if (liveCi !== null) {
          failed.push({
            orderId,
            error: `Return ${liveCi.ciNumber ?? `CI #${liveCi.id}`} is with billing — it can't be restored here`,
          });
          continue;
        }
        updateData = { workflowStage: "pending_support", dispatchStatus: null };
        toStage = "pending_support";
        note = "Restored to decisions";
      } else {
        // unhold (2026-09-22) — the 8 s Undo on the bottom bar's bulk Hold.
        // Puts back the ONE thing hold changed: `dispatchStatus`. Stage, slot,
        // trip and pick assignment were never written by hold, so they are
        // still exactly as they were. `heldAt` is left alone, as Release leaves
        // it (it is the arrival date, CLAUDE_FLOOR §4.5).
        //
        // 🔴 THE STATUS IS DERIVED FROM THE STAGE, NEVER TAKEN FROM THE CALLER.
        // A stage the bill reached by being sent to the floor
        // (FLOOR_CLEAR_HOLD_STAGES) gets "dispatch" back. Anything else —
        // pending_support and the tint stages — gets NULL: "dispatch" on those
        // leaves a bill no screen shows (release-stages.ts, the
        // pending_support note).
        if (order.dispatchStatus !== "hold") {
          failed.push({ orderId, error: "Bill is not on hold" });
          continue;
        }
        updateData = {
          dispatchStatus: FLOOR_CLEAR_HOLD_STAGES.includes(order.workflowStage) ? "dispatch" : null,
        };
        // ⚠ NOT a hold note — FLOOR_CLEAR_HOLD_NOTE is kept OUT of
        // HOLD_LOG_NOTES so a re-held bill's "held since" is its new hold.
        note = FLOOR_CLEAR_HOLD_NOTE;
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
