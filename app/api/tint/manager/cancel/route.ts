import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { type CancelReason } from "@/lib/picking/cancel-reasons";
import { FLOOR_REMARK_MAX, isFloorCancelReason, offFloorRefusal } from "@/lib/floor/off-floor";
import { applyBillAction, BILL_ACTION_ORDER_SELECT } from "@/lib/floor/bill-actions";
import { stopTintWork } from "@/lib/tint/stop-work";
import { checkTintAction, tintBillRefusal } from "@/lib/tint/manager-bill";

export const dynamic = "force-dynamic";

// POST /api/tint/manager/cancel — cancel TINT BILLS from the Tint Manager
// (2026-10-01, tabs build step 3 — plan §C, §D).
//
// Two bodies:
//   Cancel (waiting bills):  { orderIds: number[], reasonKey, remark? }
//   Stop & cancel (ONE bill at tint_assigned / tinting_in_progress, incl. a
//   paused job):             { stop: true, orderId: number, reasonKey, remark? }
// Response: Floor's shape — { done, failed }, 422 when nothing landed; Stop &
// cancel adds { stopped: { assignmentsEnded, splitsCancelled } }.
//
// Gate: tint_manager canEdit AND tint_cancel canEdit. The reason is MANDATORY
// here (400 without one) — Floor's vocabulary (lib/floor/off-floor.ts
// FLOOR_CANCEL_REASONS, itself Picking's), never a label of our own.
//
// 🔴 STOP & CANCEL — THE WRITE ORDER IS THE SAFETY (owner decision 10, plan §D):
//   0. read + refuse (tint bill; tint-room stage; cancelled / dispatched / on a
//      trip refused BEFORE anything is stopped, or the bill would be left
//      stopped and un-cancellable);
//   1. lib/tint/stop-work.ts — end the live assignment (timer frozen);
//   2. same — cancel live splits;
//   3. lib/floor/bill-actions.ts applyBillAction("cancel", allowTintRoom) —
//      the bill's ONE orders.update + pick_assignments clear + ONE log.
// A failure after 1 or 2 leaves the bill at its tint stage with NO live job:
// no operator can finish it (done needs an active assignment), it cannot reach
// picking, and pressing Stop & cancel again finishes the job — stopTintWork is
// idempotent, so a bill with zero live jobs goes straight to step 3.
// Never the other way round: a cancelled bill with a live assignment is a row
// nobody can clean up from the UI.
//
// Cancel of a WAITING bill: applyBillAction("cancel") alone — its tint arm
// already cancels legacy live splits first. A tint-room bill is refused there
// with "use Stop & cancel".
//
// Sequential awaits, never prisma.$transaction (CORE §3).

interface Body {
  stop?: boolean;
  orderId?: number;
  orderIds?: number[];
  reasonKey?: string;
  remark?: string | null;
}

interface Failed {
  orderId: number;
  error: string;
}

const TINT_ROOM = ["tint_assigned", "tinting_in_progress"];

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const changedById = Number(session.user.id);
  if (!Number.isInteger(changedById) || changedById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const stop = body.stop === true;

  const roles = session.user.roles ?? [session.user.role];
  const refused = await checkTintAction(roles, stop ? "stop-cancel" : "cancel");
  if (refused !== null) return NextResponse.json({ error: refused }, { status: 403 });

  // ── The reason — mandatory, validated once ──────────────────────────────
  if (body.reasonKey === undefined || body.reasonKey === null || body.reasonKey === "") {
    return NextResponse.json({ error: "A cancel reason is required" }, { status: 400 });
  }
  if (!isFloorCancelReason(body.reasonKey)) {
    return NextResponse.json({ error: `Unknown cancel reason "${String(body.reasonKey)}"` }, { status: 400 });
  }
  const cancelReason: CancelReason = body.reasonKey;
  let cancelRemark: string | null = null;
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

  // ── Stop & cancel — ONE bill ─────────────────────────────────────────────
  if (stop) {
    const orderId = body.orderId;
    if (typeof orderId !== "number" || !Number.isInteger(orderId) || orderId <= 0) {
      return NextResponse.json({ error: "orderId is required and must be a positive integer" }, { status: 400 });
    }

    // 0. Read + refuse — nothing is stopped unless the cancel can follow.
    const order = await prisma.orders.findUnique({ where: { id: orderId }, select: BILL_ACTION_ORDER_SELECT });
    const notTint = tintBillRefusal(order);
    if (notTint !== null || order === null) {
      return NextResponse.json({ done: [], failed: [{ orderId, error: notTint ?? "Order not found" }] }, { status: 422 });
    }
    if (!TINT_ROOM.includes(order.workflowStage)) {
      return NextResponse.json(
        { done: [], failed: [{ orderId, error: "Not in the tint room — use Cancel" }] },
        { status: 422 },
      );
    }
    const pre = offFloorRefusal(
      {
        workflowStage: order.workflowStage,
        tripDropId: order.tripDropId,
        tripNumber: order.tripDrop?.trip.tripNumber ?? null,
      },
      { allowTintRoom: true },
    );
    if (pre !== null) {
      return NextResponse.json({ done: [], failed: [{ orderId, error: pre }] }, { status: 422 });
    }

    // 1 + 2. End the live assignment, then cancel live splits. Idempotent: on a
    // retry after a partial failure, both find nothing live and write nothing.
    let stopped: { assignmentsEnded: number; splitsCancelled: number };
    try {
      stopped = await stopTintWork({ orderId, managerId: changedById, note: "Stopped & cancelled from Tint Manager" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      console.error(`[tint/cancel] order #${orderId}: stop failed part-way:`, err);
      return NextResponse.json(
        {
          done: [],
          failed: [{ orderId, error: `The job could not be fully stopped — press Stop & cancel again (${message})` }],
        },
        { status: 422 },
      );
    }

    // 3. The cancel — the bill's one orders.update + one log.
    try {
      const r = await applyBillAction(
        order,
        "cancel",
        { cancelReason, cancelRemark, allowTintRoom: true },
        changedById,
        "tint",
      );
      if (r.kind !== "done") {
        const error = r.kind === "failed" ? r.error : "Nothing to cancel";
        return NextResponse.json(
          { done: [], failed: [{ orderId, error: `Job stopped, but the bill was not cancelled — ${error}` }], stopped },
          { status: 422 },
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      console.error(`[tint/cancel] order #${orderId}: stopped, cancel write failed:`, err);
      return NextResponse.json(
        {
          done: [],
          failed: [{ orderId, error: `Job stopped, but the bill was not cancelled — press Stop & cancel again (${message})` }],
          stopped,
        },
        { status: 422 },
      );
    }
    return NextResponse.json({ done: [orderId], failed: [], stopped });
  }

  // ── Cancel — waiting bills, a batch ──────────────────────────────────────
  const orderIds = body.orderIds;
  if (!Array.isArray(orderIds) || orderIds.length === 0 || !orderIds.every((id) => typeof id === "number" && Number.isInteger(id))) {
    return NextResponse.json({ error: "orderIds is required and must be a non-empty array of integers" }, { status: 400 });
  }

  const done: number[] = [];
  const failed: Failed[] = [];
  for (const orderId of orderIds) {
    try {
      const order = await prisma.orders.findUnique({ where: { id: orderId }, select: BILL_ACTION_ORDER_SELECT });
      const notTint = tintBillRefusal(order);
      if (notTint !== null || order === null) {
        failed.push({ orderId, error: notTint ?? "Order not found" });
        continue;
      }
      // No allowTintRoom: a bill an operator holds is refused here with
      // "use Stop & cancel on Tint Manager".
      const r = await applyBillAction(order, "cancel", { cancelReason, cancelRemark }, changedById, "tint");
      if (r.kind === "failed") failed.push({ orderId, error: r.error });
      else if (r.kind === "done") done.push(orderId);
    } catch (err) {
      failed.push({ orderId, error: err instanceof Error ? err.message : "Unexpected error" });
    }
  }

  const status = done.length === 0 && failed.length > 0 ? 422 : 200;
  return NextResponse.json({ done, failed }, { status });
}
