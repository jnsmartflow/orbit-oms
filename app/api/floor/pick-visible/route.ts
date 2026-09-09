import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { SUPPORT_DONE_OUTPUT } from "@/lib/workflow-stages";

export const dynamic = "force-dynamic";

interface Failed {
  orderId: number;
  error: string;
}

/**
 * POST /api/floor/pick-visible — hand waiting bills over to the picking floor.
 *
 * Body: `{ orderIds: number[] }`. Single = an array of one; bulk = the operator's
 * whole selection. Stamps `orders.pickVisibleAt` / `pickVisibleById`, which is
 * what the picking visibility gate filters on
 * (`lib/picking/visibility-gate.ts` + `buildPickingWhere`'s waiting branch).
 *
 * Same 422/partial contract as `/api/floor/release` and `/api/floor/actions`:
 * 422 when NOTHING was achieved, 200 otherwise, and the `failed` list always
 * rides along so a partial write can never be read as a clean success.
 *
 * ═══ 🔒 LAYER 3 — THE SERVER REFUSAL. THIS IS THE COPY THAT LASTS ═══
 *
 * Owner ruling: a bill that is with a picker, or already picked, or checked, can
 * NEVER be marked visible — there is nothing to hand over, the handover already
 * happened. Three layers enforce it: the button (which does not offer it), the
 * query (which never gates those stages), and THIS. The other two are UI and can
 * be changed by anyone in an afternoon; a direct POST bypasses both and lands
 * here. Do not remove this check as redundant — it is the only one that holds
 * when the other two are wrong.
 *
 * ⚠ NO `order_status_logs` ROW IS WRITTEN, and that is deliberate.
 *   - The order already carries the whole record: `pickVisibleById` is who,
 *     `pickVisibleAt` is when. A log row would be a second copy of two columns.
 *   - Unlike hide (ORDER_HIDDEN) or early release (PICK_EARLY_RELEASED), this is
 *     a routine, high-frequency action — an operator works through a selection
 *     several times a day. At 100+ bills a day the log would be noise that
 *     buries the events somebody actually reads back.
 *   - It would also be a SECOND write per bill. The live-sync markers key on
 *     `MAX(orders.updatedAt)`, so every extra write on a picking path fires a
 *     false "changed" on every board (FLOOR §4 / PICKING §10). One write per
 *     bill is the contract, and this route keeps it.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // canEdit, not canView — handing work to the floor changes what three
  // supervisors see on their phones. The admin bypass lives inside
  // checkAnyPermission (lib/permissions.ts), so this is the standard shape.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Who actually did this — the real session, never a body claim. Number("") is
  // 0 and finite, so test for a real positive integer (the release routes' rule).
  const visibleById = Number(session.user.id);
  if (!Number.isInteger(visibleById) || visibleById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { orderIds?: number[] };
  const orderIds = body.orderIds;
  // Rejected BEFORE the loop, exactly as /api/floor/release rejects an empty
  // `releases`. This is what lets a 422 below mean "every bill was tried and
  // every bill failed" rather than "you sent nothing".
  if (
    !Array.isArray(orderIds) ||
    orderIds.length === 0 ||
    !orderIds.every((id) => typeof id === "number" && Number.isInteger(id))
  ) {
    return NextResponse.json(
      { error: "orderIds is required and must be a non-empty array of integers" },
      { status: 400 },
    );
  }

  const shown: number[] = [];
  const skipped: number[] = [];
  const failed: Failed[] = [];

  for (const orderId of orderIds) {
    try {
      // Sequential awaits only — never prisma.$transaction (CORE §3).
      const order = await prisma.orders.findUnique({
        where: { id: orderId },
        select: { id: true, workflowStage: true, isRemoved: true, pickVisibleAt: true },
      });
      if (!order || order.isRemoved) {
        failed.push({ orderId, error: "Order not found" });
        continue;
      }

      // 🔒 THE LOCKED RULE. Only a WAITING bill can be handed over. A
      // pick_assigned / pick_done / pick_checked bill is refused whatever the
      // client sends, and the message names the stage so the refusal is
      // diagnosable rather than mysterious.
      if (order.workflowStage !== SUPPORT_DONE_OUTPUT) {
        failed.push({
          orderId,
          error: `Cannot show a bill at stage ${order.workflowStage} — only waiting bills can be shown.`,
        });
        continue;
      }

      // Already handed over → a SKIP, not a failure, and NO WRITE.
      //
      // Re-selecting a bill that is already visible is an ordinary bulk-selection
      // accident, not an error: the operator asked for a state the bill is
      // already in, so the request succeeded and there was simply no work. It is
      // reported separately from `shown` so the client can say "4 shown, 2
      // already visible" instead of claiming six writes it did not make.
      //
      // ⚠ AND THE WRITE MUST NOT HAPPEN. Re-stamping would bump
      // `orders.updatedAt` and fire a false "changed" on every board's marker
      // (PICKING §10) — every supervisor's phone would do a full queue refetch
      // for a bill whose state did not move. It would also overwrite the
      // original actor and time with whoever fat-fingered the checkbox.
      if (order.pickVisibleAt !== null) {
        skipped.push(orderId);
        continue;
      }

      // EXACTLY ONE orders.update per bill. Both columns land in the same row
      // write, so the stamp is atomic on its own and no ordering hazard exists.
      await prisma.orders.update({
        where: { id: orderId },
        data: { pickVisibleAt: new Date(), pickVisibleById: visibleById },
      });

      shown.push(orderId);
    } catch (err) {
      failed.push({ orderId, error: err instanceof Error ? err.message : "Unexpected error" });
    }
  }

  // Nothing achieved at all → 422, so a fully-rejected request cannot be read as
  // success. A SKIP counts as achieved: the bills the operator asked to be
  // visible are visible, which is the outcome he wanted.
  const status = shown.length === 0 && skipped.length === 0 && failed.length > 0 ? 422 : 200;
  return NextResponse.json({ shown, skipped, failed }, { status });
}
