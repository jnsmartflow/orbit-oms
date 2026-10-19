import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isSuperuser } from "@/lib/rbac";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { deskCancelRequiresNote, type DeskCancelReason } from "@/lib/floor/desk-cancel-reasons";
import { FLOOR_REMARK_MAX, isFloorCancelReason } from "@/lib/floor/off-floor";
import { notifyHandSet } from "@/lib/push/hand";
import {
  applyBillAction,
  resolveChangeSlot,
  BILL_ACTIONS,
  BILL_ACTION_ORDER_SELECT,
  type BillAction,
  type ResolvedSlot,
} from "@/lib/floor/bill-actions";
import { holdRows, releaseRows } from "@/lib/order-invoices/hold";

export const dynamic = "force-dynamic";

// Floor Control — bulk + single actions on floor/rail bills (design §7.8-§7.11,
// §9). NOT assignment: Assign/Unassign go through the existing Picking endpoints
// unchanged (see components/floor/floor-page.tsx). This route owns the eight
// state actions below.
//
// Since 2026-10-01 (Tint Manager tabs build step 2) the per-bill rule and the
// write block live in lib/floor/bill-actions.ts applyBillAction, shared with
// app/api/tint/manager/actions. This route keeps the body validation, the loop
// and the response — behaviour, notes, shape and status codes unchanged.
//
// Contract per bill, non-negotiable (CORE §3 + CLAUDE_PICKING §10):
//   - sequential awaits, never prisma.$transaction
//   - exactly ONE orders.update per bill (a second write fires a false "changed"
//     on every board's updatedAt live-sync marker)
//   - exactly ONE order_status_logs row per bill per action

interface Body {
  action?: BillAction;
  orderIds?: number[];
  urgent?: boolean; // mark-urgent: explicit set (bar). Omitted → per-bill toggle (row ⚡).
  dispatchTargetDate?: string; // change-slot: YYYY-MM-DD
  dispatchWindowId?: number; // change-slot
  reason?: string; // cancel: legacy free-text note, used only when reasonKey is absent
  reasonKey?: string; // cancel: one of FLOOR_CANCEL_REASONS (lib/floor/off-floor.ts)
  remark?: string; // cancel: optional, ≤ FLOOR_REMARK_MAX, goes after the reason label
  /** hold / unhold PER INVOICE (Add invoices 6.1): orderId → the split OBD's
   *  ticked order_invoices ids (some or all). An OBD absent here acts whole,
   *  exactly as before. */
  invoiceRowIds?: Record<string, number[]>;
}

interface Failed {
  orderId: number;
  error: string;
  /** A per-invoice refusal (6.1) — that invoice only; the rest of the OBD may be in `done`. */
  invoiceRowId?: number;
  invoiceNo?: string | null;
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
  if (!action || !BILL_ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Unknown or missing action" }, { status: 400 });
  }

  const orderIds = body.orderIds;
  if (!Array.isArray(orderIds) || orderIds.length === 0 || !orderIds.every((id) => typeof id === "number" && Number.isInteger(id))) {
    return NextResponse.json({ error: "orderIds is required and must be a non-empty array of integers" }, { status: 400 });
  }

  // change-slot needs a valid date + window up front; resolve window labels once.
  let slot: ResolvedSlot | undefined;
  if (action === "change-slot") {
    const r = await resolveChangeSlot(body.dispatchTargetDate, body.dispatchWindowId);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    slot = r.slot;
  }

  // cancel: a reason KEY, when sent, is validated once up front — a bad value is
  // a clean 400, never a note recording a reason nobody chose. Absent means the
  // legacy note (the detail panel sends none until the 5b form lands).
  let cancelReason: DeskCancelReason | null = null;
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
    // "Other" alone records nothing — the remark is required (desk list rule,
    // 2026-10-01; Picking applies the same rule to its own "Other").
    if (cancelReason !== null && deskCancelRequiresNote(cancelReason) && cancelRemark === null) {
      return NextResponse.json({ error: "A remark is required when the reason is Other" }, { status: 400 });
    }
  }

  // 6.1 — validated up front: integer arrays, only for hold / unhold.
  const rowIdsByOrder = new Map<number, number[]>();
  if (body.invoiceRowIds !== undefined) {
    if (action !== "hold" && action !== "unhold") {
      return NextResponse.json({ error: "invoiceRowIds is for hold / unhold only" }, { status: 400 });
    }
    if (typeof body.invoiceRowIds !== "object" || body.invoiceRowIds === null) {
      return NextResponse.json({ error: "invoiceRowIds must map an orderId to invoice row ids" }, { status: 400 });
    }
    for (const [k, v] of Object.entries(body.invoiceRowIds)) {
      const id = Number(k);
      if (!orderIds.includes(id) || !Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === "number" && Number.isInteger(x))) {
        return NextResponse.json({ error: `invoiceRowIds[${k}] must be a non-empty array of row ids of a listed order` }, { status: 400 });
      }
      rowIdsByOrder.set(id, Array.from(new Set(v)));
    }
  }

  const done: number[] = [];
  const failed: Failed[] = [];
  // hand / unhand only: a repeat press (the mark is already as asked) writes
  // NOTHING — no update, no log — and is reported here, not as a failure.
  // 6.1 per-invoice hold / unhold uses it too (nothing changed, nothing written).
  const skipped: number[] = [];
  // 6.1 — orderId → the invoice rows a per-invoice press really changed (the
  // 8 s Undo releases exactly these).
  const doneRows: Record<number, number[]> = {};

  for (const orderId of orderIds) {
    const rowIds = rowIdsByOrder.get(orderId);
    if (rowIds !== undefined) {
      // PER INVOICE — lib/order-invoices/hold.ts, the only row-hold writer.
      try {
        const r = action === "hold" ? await holdRows(orderId, rowIds, changedById) : await releaseRows(orderId, rowIds, changedById);
        for (const x of r.refused) failed.push({ orderId, error: x.error, invoiceRowId: x.rowId, invoiceNo: x.invoiceNo });
        if (r.kind === "done") {
          done.push(orderId);
          doneRows[orderId] = r.rowIds;
        } else if (r.kind === "skipped") skipped.push(orderId);
        else if (r.refused.length === 0) failed.push({ orderId, error: r.error });
      } catch (err) {
        failed.push({ orderId, error: err instanceof Error ? err.message : "Unexpected error" });
      }
      continue;
    }
    try {
      const order = await prisma.orders.findUnique({
        where: { id: orderId },
        select: BILL_ACTION_ORDER_SELECT,
      });
      if (!order || order.isRemoved) {
        failed.push({ orderId, error: "Order not found" });
        continue;
      }

      const r = await applyBillAction(
        order,
        action,
        // actorIsAdmin: a challan (ORB) order is admin-only to cancel (S5-4).
        { urgent: body.urgent, slot, cancelReason, cancelRemark, reason: body.reason, actorIsAdmin: isSuperuser(session) },
        changedById,
        "floor",
      );
      if (r.kind === "failed") failed.push({ orderId, error: r.error });
      else if (r.kind === "skipped") skipped.push(orderId);
      else done.push(orderId);
    } catch (err) {
      failed.push({ orderId, error: err instanceof Error ? err.message : "Unexpected error" });
    }
  }

  // Nothing changed at all → 422 so a fully-skipped action cannot be read as
  // success by the client. A partial success stays 200 but always carries the
  // `failed` list to be surfaced (the swallowed-response bug this closes).
  // Hand set → the supervisors hear about it: only the bills actually marked;
  // awaited and swallowed — it never changes this response.
  if (action === "hand" && done.length > 0) {
    await notifyHandSet(done, changedById);
  }

  const status = done.length === 0 && failed.length > 0 ? 422 : 200;
  return NextResponse.json(
    {
      done,
      failed,
      ...(skipped.length > 0 ? { skipped } : {}),
      ...(Object.keys(doneRows).length > 0 ? { doneRows } : {}),
    },
    { status },
  );
}
