import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifyHandSet } from "@/lib/push/hand";
import {
  applyBillAction,
  resolveChangeSlot,
  BILL_ACTION_ORDER_SELECT,
  type ResolvedSlot,
} from "@/lib/floor/bill-actions";
import { BASE_PICKER_HOLD_REFUSAL, checkTintAction, tintManagerBillRefusal } from "@/lib/tint/manager-bill";
import { getColourWorkByOrder } from "@/lib/picking/colour-work-query";

export const dynamic = "force-dynamic";

// POST /api/tint/manager/actions — the Tint Manager's hold / release / hand /
// slot on TINT BILLS (2026-10-01, tabs build step 2 — plan §C).
//
// Body: { action: "hold" | "unhold" | "hand" | "unhand" | "change-slot",
//         orderIds: number[], dispatchTargetDate?, dispatchWindowId? }
// Response: Floor's exactly — { done, failed, skipped? }, 422 when nothing landed.
//
// 🔴 NOT A COPY OF FLOOR'S RULES. Per bill it (1) refuses a non-tint bill, then
// (2) calls lib/floor/bill-actions.ts applyBillAction — the SAME function
// app/api/floor/actions calls — with surface "tint", which only picks the hold
// log notes (TINT_HOLD_NOTE / TINT_CLEAR_HOLD_NOTE). Stage rules, writes, the
// one-update / one-log contract and the refusal texts are that function's.
//
// "Release" on the Tint Manager = `unhold` (owner decision 9): the hold clears,
// the stage does not move. A waiting bill goes back to the rail; a mid-tint bill
// keeps tinting and completion dispatches it. Floor's /api/floor/release is NOT
// used — it refuses every tint stage.
//
// Gate: tint_manager canEdit AND the action's tick (lib/tint/manager-bill.ts).
//
// BASE BILLS (2026-10-01, Base tab — owner §I): hold / unhold / change-slot also
// accept a NON-tint SMU 74/77 bill, through tintManagerBillRefusal with the
// action. hand / unhand are not Base actions and still refuse it; hold refuses a
// Base bill a picker holds (pick_assigned / pick_done, decision 1).
// cancel / restore / CI are NOT accepted here (build step 3).

// mark-urgent (2026-10-02, owner): Floor's own mark-urgent arm of applyBillAction
// (priorityLevel 1 ↔ 3), on its own tick tint_urgent, tint AND Base bills.
// `urgent` true sets, false clears; omitted toggles (Floor's contract).
type TintBoardAction = "hold" | "unhold" | "hand" | "unhand" | "change-slot" | "mark-urgent";
const TINT_BOARD_ACTIONS: TintBoardAction[] = ["hold", "unhold", "hand", "unhand", "change-slot", "mark-urgent"];

interface Body {
  action?: TintBoardAction;
  orderIds?: number[];
  dispatchTargetDate?: string; // change-slot: YYYY-MM-DD
  dispatchWindowId?: number; // change-slot
  urgent?: boolean; // mark-urgent
}

interface Failed {
  orderId: number;
  error: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const changedById = Number(session.user.id);
  if (!Number.isInteger(changedById) || changedById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const action = body.action;
  if (!action || !TINT_BOARD_ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Unknown or missing action" }, { status: 400 });
  }

  // The gate names the action, so it runs once the action is known.
  const roles = session.user.roles ?? [session.user.role];
  const refused = await checkTintAction(roles, action);
  if (refused !== null) return NextResponse.json({ error: refused }, { status: 403 });

  const orderIds = body.orderIds;
  if (!Array.isArray(orderIds) || orderIds.length === 0 || !orderIds.every((id) => typeof id === "number" && Number.isInteger(id))) {
    return NextResponse.json({ error: "orderIds is required and must be a non-empty array of integers" }, { status: 400 });
  }

  let slot: ResolvedSlot | undefined;
  if (action === "change-slot") {
    const r = await resolveChangeSlot(body.dispatchTargetDate, body.dispatchWindowId);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    slot = r.slot;
  }

  const done: number[] = [];
  const failed: Failed[] = [];
  // hand / unhand only: a repeat press writes nothing and is reported here.
  const skipped: number[] = [];

  for (const orderId of orderIds) {
    try {
      const order = await prisma.orders.findUnique({
        where: { id: orderId },
        select: { ...BILL_ACTION_ORDER_SELECT, orderType: true, smu: true },
      });
      const notTint = tintManagerBillRefusal(order, action);
      if (notTint !== null || order === null) {
        failed.push({ orderId, error: notTint ?? "Order not found" });
        continue;
      }
      // A "Base — No Tint" bill is a BASE order (2026-10-02): the Base tab's
      // hold rule applies — refused once a picker has it (owner §I-1). Decided by
      // Picking's colour rule (getColourWorkByOrder), only on the stages it matters.
      if (action === "hold" && order.orderType === "tint" && (order.workflowStage === "pick_assigned" || order.workflowStage === "pick_done")) {
        const colour = await getColourWorkByOrder([{ orderId, smu: order.smu, orderType: order.orderType }]);
        if (colour.get(orderId) === "base") {
          failed.push({ orderId, error: BASE_PICKER_HOLD_REFUSAL });
          continue;
        }
      }

      const r = await applyBillAction(order, action, { slot, urgent: typeof body.urgent === "boolean" ? body.urgent : undefined }, changedById, "tint");
      if (r.kind === "failed") failed.push({ orderId, error: r.error });
      else if (r.kind === "skipped") skipped.push(orderId);
      else done.push(orderId);
    } catch (err) {
      failed.push({ orderId, error: err instanceof Error ? err.message : "Unexpected error" });
    }
  }

  // Hand set → the supervisors hear about it, as from Floor. Awaited and
  // swallowed — it never changes this response.
  if (action === "hand" && done.length > 0) {
    await notifyHandSet(done, changedById);
  }

  const status = done.length === 0 && failed.length > 0 ? 422 : 200;
  return NextResponse.json({ done, failed, ...(skipped.length > 0 ? { skipped } : {}) }, { status });
}
