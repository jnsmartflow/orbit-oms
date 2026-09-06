import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAnyPermission } from "@/lib/permissions";
import { TINT_STATUS_DONE } from "@/lib/tint/assignment-status";
import { getBaseOperatorId } from "@/lib/tint/base-operator";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Undo a "Base — No Tint" bypass.
//
// The bypass is a one-click action that sends a bill onward, so it is exactly
// the kind of thing a manager does by mistake — wrong row, wrong bill, or a
// tinting line they had not noticed. This puts it back on the rail.
//
// ⚠ IT IS ONLY SAFE WHILE NOBODY HAS ACTED ON THE BILL, and the three guards
// below are what establish that. They were derived by walking what a bypass
// actually sets in motion (base-bypass/route.ts writes pending_support with a
// completion slot, which puts the bill straight onto Floor's rail — rank < 60 —
// or onto /picking when a slot was pre-set), then asking what downstream could
// have consumed it. Each guard refuses with its own message rather than a
// generic failure, because "can't undo" without a reason is what makes an
// operator retry, then call.
//
// Shape and order-of-checks follow app/api/tint/manager/manual-entry/revert/
// route.ts — the existing precedent for a guarded revert on this board: a typed
// errorCode union, `{ ok: false, errorCode, message }`, cheapest/most-specific
// check first, and every message written to be shown to the manager verbatim.
//
// Sequential awaits, never prisma.$transaction (CORE §3). The write order is the
// reverse of the bypass's: the order moves back FIRST, the assignment row goes
// SECOND, audit LAST — so a mid-sequence failure leaves the bill visible on the
// rail (recoverable, a manager can see it) rather than deleted-but-still-gone.
// ─────────────────────────────────────────────────────────────────────────────

type ErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "NOT_A_BYPASS"
  | "TI_ALREADY_RECORDED"
  | "ALREADY_PICKED"
  | "ALREADY_ON_FLOOR"
  | "PLACEHOLDER_MISSING"
  | "INTERNAL_ERROR";

function err(code: ErrorCode, message: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, errorCode: code, message }, { status });
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user tick, not a job title. canEdit, not canView — this deletes a row
  // and moves a bill between stages (CLAUDE_TINT.md §13.3: a view tick is not
  // write authority).
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "tint_manager", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return err("BAD_REQUEST", "Invalid JSON body", 400);
  }
  const { orderId } = (body ?? {}) as { orderId?: unknown };
  if (!isPositiveInt(orderId)) {
    return err("BAD_REQUEST", "orderId must be a positive integer", 400);
  }

  // The acting human, from the session — never hardcoded. This is who undid it,
  // and it is what both audit rows record.
  const actorId = parseInt(session!.user.id, 10);
  if (Number.isNaN(actorId)) {
    return err("INTERNAL_ERROR", "Invalid session user id", 500);
  }

  const placeholderId = await getBaseOperatorId();
  if (placeholderId === null) {
    console.error("[tint/manager/base-bypass/undo] placeholder worker missing", { orderId });
    return err("PLACEHOLDER_MISSING", "placeholder worker missing — contact admin", 500);
  }

  const order = await prisma.orders.findFirst({
    where:  { id: orderId, isRemoved: false },
    select: {
      id:                 true,
      obdNumber:          true,
      workflowStage:      true,
      dispatchStatus:     true,
      dispatchSlotSource: true,
    },
  });
  if (!order) return err("NOT_FOUND", `No order found with id ${orderId}`, 404);

  // ── Guard 1: this must actually BE a live bypass ───────────────────────────
  // The placeholder-owned, tinting_done row is the bypass's whole footprint. No
  // row means it was never bypassed, or an undo already ran, or someone deleted
  // it by hand. All three are "nothing here to undo".
  const assignment = await prisma.tint_assignments.findFirst({
    where:  { orderId, assignedToId: placeholderId, status: TINT_STATUS_DONE },
    select: { id: true },
  });
  if (!assignment) {
    return err("NOT_A_BYPASS", "This order isn't a pending Base bypass.", 404);
  }

  // ── Guard 2: no paperwork started ──────────────────────────────────────────
  // Checked FIRST of the three because it is the one an undo would actively
  // destroy: `tinter_issue_entries.tintAssignmentId` is ON DELETE CASCADE, so
  // deleting the assignment would silently take every TI row — and the sampling
  // numbers those rows minted in the Library would be left pointing at nothing.
  // The other two guards protect against a confusing state; this one protects
  // against data loss, so it goes first.
  const [tiA, tiB] = await Promise.all([
    prisma.tinter_issue_entries.count({ where: { tintAssignmentId: assignment.id } }),
    prisma.tinter_issue_entries_b.count({ where: { tintAssignmentId: assignment.id } }),
  ]);
  if (tiA + tiB > 0) {
    return err(
      "TI_ALREADY_RECORDED",
      "Paperwork has already been started on this order — can't undo, contact admin",
      400,
    );
  }

  // ── Guard 3: nobody has picked it ──────────────────────────────────────────
  // A pick_assignments row means the bill reached the floor and a picker holds
  // it (or has finished it). Pulling it back to the tint rail underneath them
  // would leave an assignment pointing at a bill that is no longer in picking.
  const picks = await prisma.pick_assignments.count({ where: { orderId } });
  if (picks > 0) {
    return err("ALREADY_PICKED", "This order has already been picked — can't undo", 400);
  }

  // ── Guard 4: Floor has not acted ───────────────────────────────────────────
  // `dispatchSlotSource` is null until a human touches the slot. Floor's Release
  // and change-slot paths both write 'manual' (CLAUDE_CORE.md §7.4's manual-skip
  // guard is why), and the dispatch engine writes 'auto'. Either way a non-null
  // value means the bill has been decided for a dispatch window by something
  // other than this bypass — the bypass itself never writes this column.
  if (order.dispatchSlotSource !== null) {
    return err("ALREADY_ON_FLOOR", "This order has already moved on Floor — can't undo", 400);
  }

  // ── All guards passed — revert ─────────────────────────────────────────────
  // Field-for-field the inverse of base-bypass/route.ts's step 4b.
  //
  // slotId/originalSlotId go to NULL rather than to a previous value: a tint
  // order carries null from import until completion (CLAUDE_CORE.md §9), so
  // there is no prior value to restore — null IS the correct state for a bill
  // back on the rail.
  //
  // dispatchStatus is cleared ONLY when it reads exactly "dispatch", the one
  // value the bypass could have written (its preset branch). On the no-preset
  // branch the bypass never touched the column, so clearing it unconditionally
  // would wipe a Hold or an enrichment-set value that has nothing to do with us.
  try {
    await prisma.orders.update({
      where: { id: orderId },
      data: {
        workflowStage:  "pending_tint_assignment",
        slotId:         null,
        originalSlotId: null,
        // sequenceOrder is deliberately left alone: it is a per-operator queue
        // position and the bill has no operator now. assign/route.ts recomputes
        // it as MAX+1 on the next assignment.
        ...(order.dispatchStatus === "dispatch" ? { dispatchStatus: null } : {}),
      },
    });
  } catch (e) {
    console.error("[tint/manager/base-bypass/undo] orders.update failed", {
      orderId, assignmentId: assignment.id, step: "orders",
      error: e instanceof Error ? e.message : String(e),
    });
    return err("INTERNAL_ERROR", "Could not move the bill back — nothing was changed", 500);
  }

  try {
    // Guard 2 established there are no TI rows, so this cascade deletes nothing.
    await prisma.tint_assignments.delete({ where: { id: assignment.id } });
  } catch (e) {
    console.error("[tint/manager/base-bypass/undo] assignment delete failed", {
      orderId, assignmentId: assignment.id, step: "tint_assignments",
      error: e instanceof Error ? e.message : String(e),
    });
    return err(
      "INTERNAL_ERROR",
      "The bill is back on the rail but its bypass record could not be removed — notify admin",
      500,
    );
  }

  // Audit, INSERT-ONLY — never skipped.
  try {
    await prisma.order_status_logs.create({
      data: {
        orderId,
        fromStage:   order.workflowStage,
        toStage:     "pending_tint_assignment",
        changedById: actorId,
        note:        "Base — No Tint undone.",
      },
    });
    await prisma.tint_logs.create({
      data: {
        orderId,
        action:        "base_no_tint_undone",
        performedById: actorId,
        note:          "Base — No Tint undone. Bill returned to the tint rail.",
      },
    });
  } catch (e) {
    console.error("[tint/manager/base-bypass/undo] audit write failed", {
      orderId, assignmentId: assignment.id, step: "audit",
      error: e instanceof Error ? e.message : String(e),
    });
    return err(
      "INTERNAL_ERROR",
      "Undo applied but audit logging failed — notify admin",
      500,
    );
  }

  return NextResponse.json({ ok: true, orderId, obdNumber: order.obdNumber });
}
