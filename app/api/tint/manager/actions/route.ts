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
import { checkTintAction, tintBillRefusal } from "@/lib/tint/manager-bill";

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
// cancel / restore / CI are NOT accepted here (build step 3).

type TintBoardAction = "hold" | "unhold" | "hand" | "unhand" | "change-slot";
const TINT_BOARD_ACTIONS: TintBoardAction[] = ["hold", "unhold", "hand", "unhand", "change-slot"];

interface Body {
  action?: TintBoardAction;
  orderIds?: number[];
  dispatchTargetDate?: string; // change-slot: YYYY-MM-DD
  dispatchWindowId?: number; // change-slot
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
        select: { ...BILL_ACTION_ORDER_SELECT, orderType: true },
      });
      const notTint = tintBillRefusal(order);
      if (notTint !== null || order === null) {
        failed.push({ orderId, error: notTint ?? "Order not found" });
        continue;
      }

      const r = await applyBillAction(order, action, { slot }, changedById, "tint");
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
