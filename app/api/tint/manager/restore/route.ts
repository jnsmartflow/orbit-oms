import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { applyBillAction, BILL_ACTION_ORDER_SELECT } from "@/lib/floor/bill-actions";
import { checkTintAction, tintBillRefusal } from "@/lib/tint/manager-bill";

export const dynamic = "force-dynamic";

// POST /api/tint/manager/restore — un-cancel TINT BILLS from the Tint Manager
// (2026-10-01, tabs build step 3 — plan §C, §D).
//
// Body: { orderIds: number[] }
// Response: Floor's shape — { done, failed }, 422 when nothing landed.
//
// Gate: tint_manager canEdit AND tint_cancel canEdit (restore shares cancel's
// tick, so nobody can create a state they cannot undo). Tint bills only, then
// lib/floor/bill-actions.ts applyBillAction("restore") — the SAME restore Floor
// runs: must be cancelled, refused on a live CI, and a tint bill that NEVER
// finished tinting goes back to pending_tint_assignment (the rail); one that
// had finished goes to pending_support (owner 2026-10-01, plan §J-1).

interface Body {
  orderIds?: number[];
}

interface Failed {
  orderId: number;
  error: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const refused = await checkTintAction(roles, "restore");
  if (refused !== null) return NextResponse.json({ error: refused }, { status: 403 });

  const changedById = Number(session.user.id);
  if (!Number.isInteger(changedById) || changedById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
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
      const r = await applyBillAction(order, "restore", {}, changedById, "tint");
      if (r.kind === "failed") failed.push({ orderId, error: r.error });
      else if (r.kind === "done") done.push(orderId);
    } catch (err) {
      failed.push({ orderId, error: err instanceof Error ? err.message : "Unexpected error" });
    }
  }

  const status = done.length === 0 && failed.length > 0 ? 422 : 200;
  return NextResponse.json({ done, failed }, { status });
}
