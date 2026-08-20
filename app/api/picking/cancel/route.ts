import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { PICKING_CANCELLABLE_STAGES } from "@/lib/workflow-stages";
import {
  buildCancelNote,
  isCancelReason,
  cancelRequiresNote,
  CANCEL_NOTE_MAX,
} from "@/lib/picking/cancel-reasons";
import { sendToUser } from "@/lib/push/send";

export const dynamic = "force-dynamic";

/**
 * POST /api/picking/cancel — the supervisor kills an ORDER from the picking
 * board. Body: { orderId, reason, note? }.
 *
 * SAME MEANING AS FLOOR'S CANCEL (app/api/floor/actions/route.ts, action
 * 'cancel'): the whole order dies — workflowStage 'cancelled', dispatchStatus
 * cleared, one audit row. It is NOT an unassign; a bill cancelled here does not
 * return to the queue, and Floor's Cancelled tab is where it surfaces (and
 * where Restore lives — this route has no undo of its own, deliberately, so
 * there is ONE restore path in the app rather than two).
 *
 * ── WHY THIS IS ITS OWN ROUTE AND NOT A CALL TO /api/floor/actions ──────────
 * 🔴 THE FLOOR ROUTE IS UNREACHABLE FOR THE ROLE THAT PRESSES THIS BUTTON.
 * app/api/floor/actions/route.ts gates on
 * `checkAnyPermission(roles, "floor", "canEdit")`, and `floor_supervisor` holds
 * the `picking` page key but NOT `floor` (CLAUDE_CORE.md §5's picking row,
 * live-verified 2026-07-28; CLAUDE_FLOOR.md §1 repeats it). A supervisor
 * pressing a Cancel wired to that route gets a flat 403 — while admin and
 * operations, who DO hold `floor`, would see it work. "Works on my phone" is
 * the worst shape of bug report.
 *
 * The alternative — widening the floor route's gate to `floor OR picking` —
 * would keep one owner, but that route takes `orderIds[]` with no scope check
 * and serves five actions. Widening it would hand every floor_supervisor
 * mark-urgent / change-slot / hold / restore on any order id they can guess.
 * That is a permission escalation wearing a refactor's clothes. A thin route
 * gating on `picking`/`canEdit` — matching assign / unassign / approve — is the
 * correct shape, and the two write bodies are kept deliberately identical so a
 * future extraction into one shared helper is mechanical.
 *
 * ── WRITE CONTRACT (CORE §3 + CLAUDE_PICKING.md §10) ───────────────────────
 * Sequential awaits, never prisma.$transaction. EXACTLY ONE `orders.update` and
 * EXACTLY ONE `order_status_logs` row per bill — a second orders write would
 * fire a false "changed" on every board's MAX(orders.updatedAt) marker. The
 * pick_assignments delete between them touches neither, so the shape holds
 * (the same three-write shape app/api/picking/unassign/route.ts already uses).
 */

// PICKING_CANCELLABLE_STAGES MOVED to lib/workflow-stages.ts (3b). It was
// declared here when this route landed, but the ⋯ menu in the detail header
// needs the same list to decide whether to render, and a "use client" component
// importing from a route module would pull prisma and next-auth into the
// browser bundle. The stage registry is pure and already owns every other
// picking stage set. One list, imported by both sides.

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // canEdit, NOT canView — a supervisor action that destroys an order. Same
  // gate as assign / unassign / approve (corrected across those three
  // 2026-07-20). `picker` holds canView only and must never reach this.
  // Admin bypass lives inside checkAnyPermission, so no wrapper is needed.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "picking", "canEdit");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Same non-empty-string guard the sibling routes use — Number.isFinite alone
  // would let an empty session id ("") silently become 0.
  const changedById = Number(session.user.id);
  if (!Number.isInteger(changedById) || changedById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    orderId?: number;
    reason?: string;
    note?: string;
  };

  const orderId = body.orderId;
  if (typeof orderId !== "number" || !Number.isInteger(orderId)) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  // ⚠ REASON IS MANDATORY HERE, unlike on Floor. Floor's `reason` is optional
  // and no caller sends one, which is why every cancelled bill in the database
  // today reads "Cancelled from floor" and the Cancelled tab's Reason column is
  // a constant. This route exists partly to stop that: a cancel with no reason
  // is an unexplained dead order, and the log row cannot be edited afterwards.
  // Validated against the closed list BEFORE any DB work, so a bad value is a
  // clean 400 rather than a recorded non-reason.
  if (!isCancelReason(body.reason)) {
    return NextResponse.json(
      { error: "reason is required and must be one of the known cancel reasons" },
      { status: 400 },
    );
  }
  const reason = body.reason;

  // Optional free text. Rejected rather than silently truncated — a clipped
  // explanation is worse than a refused one, and the caller can see the cap.
  if (body.note !== undefined && typeof body.note !== "string") {
    return NextResponse.json({ error: "note must be a string" }, { status: 400 });
  }
  if (typeof body.note === "string" && body.note.trim().length > CANCEL_NOTE_MAX) {
    return NextResponse.json(
      { error: `note must be ${CANCEL_NOTE_MAX} characters or fewer` },
      { status: 400 },
    );
  }
  // ⚠ ADDED 2026-08-20 (3b). "Other" with no remark records nothing — it is the
  // ABSENCE of a reason wearing a label, and the log row cannot be edited
  // afterwards to add the missing words. The rule's single owner is
  // cancelRequiresNote() in lib/picking/cancel-reasons.ts; this is the
  // ENFORCING side of it. The sheet greys its confirm button on the same
  // function so a supervisor never reaches this 400 — that is a preview of the
  // rule, not a second copy of it.
  if (cancelRequiresNote(reason) && (typeof body.note !== "string" || body.note.trim().length === 0)) {
    return NextResponse.json(
      { error: "A remark is required when the reason is Other" },
      { status: 400 },
    );
  }

  // a. Fetch the order. The extra fields beyond the stage gate are all for the
  // best-effort push in step (f): read HERE, before the assignment row is
  // deleted in (d), because after that there is no way back to who held it.
  const order = await prisma.orders.findFirst({
    where: { id: orderId },
    select: {
      id: true,
      workflowStage: true,
      isRemoved: true,
      obdNumber: true,
      customer: { select: { customerName: true } },
      shipToOverrideCustomer: { select: { customerName: true } },
      pickAssignment: { select: { pickerId: true } },
    },
  });
  if (!order || order.isRemoved) {
    // A soft-removed OBD is not a live bill (CORE §3's soft-delete read rule)
    // and must not be cancellable back into a different shape.
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // b. Stage gate. 409 (not 400) so the board's EXISTING "Already changed —
  // refreshed." handler catches it: both mobile faces already special-case 409
  // on assign/unassign/approve, so a bill cancelled out from under a stale
  // screen behaves exactly like every other lost race on this board.
  if (order.workflowStage === "cancelled") {
    return NextResponse.json({ error: "Order is already cancelled." }, { status: 409 });
  }
  if (!PICKING_CANCELLABLE_STAGES.includes(order.workflowStage)) {
    return NextResponse.json(
      { error: "This bill can no longer be cancelled from picking." },
      { status: 409 },
    );
  }

  // c. FIRST write — kill the order. ONE orders.update.
  //
  // ⚠ ORDER IS NOT NEGOTIABLE, and it is the mirror of the reasoning in
  // app/api/picking/unassign/route.ts. Ask which failure leaves the worse ghost:
  //   - update first, delete second (this order). If the delete fails: the
  //     order is cancelled, off every board, with a stale pick_assignments row.
  //     A fixable leftover — and precisely the state Floor's cancel produces
  //     for EVERY bill today, so it is a state the system already survives.
  //   - delete first, update second. If the update fails: the assignment record
  //     is GONE while the bill is still pick_assigned. It shows on the
  //     supervisor's Picking tab and the picker's Pending list with no record
  //     of who has it — assignedToName, assignedAt and pickedAt all null — and
  //     unassign cannot recover it. Strictly worse, and far harder to notice.
  // Never reverse these two.
  await prisma.orders.update({
    where: { id: orderId },
    data: { workflowStage: "cancelled", dispatchStatus: null },
  });

  // d. SECOND write — clear the assignment, if any.
  //
  // 🔴 THIS IS WHAT STOPS THE BILL BECOMING PERMANENTLY UN-ASSIGNABLE. A
  // cancelled bill can be Restored from Floor's Cancelled tab, which sends it
  // to pending_support and then (via Release) to pending_picking. At that point
  // assign/route.ts's guard (c) finds the surviving pick_assignments row and
  // rejects with "Already assigned." — forever, because `orderId` is @unique
  // there and the ONLY deleter is unassign/route.ts, which requires
  // workflowStage === PICK_ASSIGNED, a stage the bill can never reach again.
  // Floor's cancel has been leaving exactly this trap behind; the same fix is
  // applied there in this change.
  //
  // deleteMany, not delete: a bill cancelled from the Assign tab never had an
  // assignment row, and that must be an ordinary no-op rather than a throw —
  // the same tolerance unassign/route.ts uses for an already-cleared row.
  //
  // Nothing FKs pick_assignments.id (schema sweep 2026-08-20 — the three users
  // relations and the orders relation all point INTO it), so this cascades
  // nowhere. pick_findings hangs off `orders` + `import_raw_line_items`, never
  // off the assignment, so a picker's recorded findings survive the cancel.
  //
  // ⚠ Does NOT touch pick_assignments.status, so the live CHECK constraint
  // chk_pick_assignments_status ('assigned' | 'picked' only — invisible in
  // schema.prisma, CLAUDE_PICKING.md §7) is not in play. Deleting a row never
  // violates a value constraint; a 'cancelled' status would have, and that is
  // exactly why this clears the row instead of restatusing it.
  const cleared = await prisma.pick_assignments.deleteMany({ where: { orderId } });

  // e. Audit. ONE log row. The reason lives HERE and nowhere else — there is no
  // cancel-reason column on `orders` (removalReason/removalRemark belong to
  // TM's Remove-OBD soft-delete, a different feature) and adding one was not
  // warranted for a value only this log renders. Floor's Cancelled tab reads
  // `note` straight into its "Reason" column.
  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage: order.workflowStage,
      toStage: "cancelled",
      changedById,
      note: buildCancelNote(reason, body.note),
    },
  });

  // f. ── Best-effort push to the PICKER who was holding it ──────────────────
  // Added 2026-08-20 (3b) so the reason sheet's amber banner tells the truth.
  // That banner says the bill vanishes from his phone AND that he is notified;
  // without this the second half was a promise the code did not keep, and a
  // supervisor who believed it might not walk over and tell him — leaving a man
  // picking a dead bill. Copy of the block in app/api/picking/assign/route.ts:
  //
  //   - FULLY SWALLOWED. The response body and status are byte-identical
  //     whether the push succeeds, fails, or is skipped. A notification is
  //     never worth failing a completed cancel over.
  //   - NO `orders` write anywhere in here (the live-sync marker keys on
  //     MAX(orders.updatedAt); an extra write would fire a false "changed" on
  //     every board). Only push_subscriptions is touched, by sendToUser.
  //   - AWAITED, because Vercel freezes the function after the response and
  //     un-awaited work is unreliable.
  //   - Skipped when nobody held the bill, and when the supervisor cancelling
  //     it IS the picker (he is looking at the screen that did it).
  //
  // The dealer name is resolved the same way every other surface resolves it:
  // ship-to override first, plain customer second (CORE §7.3).
  const heldByPickerId = order.pickAssignment?.pickerId ?? null;
  if (heldByPickerId !== null && heldByPickerId !== changedById) {
    try {
      const dealerName =
        order.shipToOverrideCustomer?.customerName ?? order.customer?.customerName ?? "(Unmatched)";
      await sendToUser(heldByPickerId, {
        title: "Bill cancelled",
        body: `${dealerName} · ${order.obdNumber} — stop picking this bill`,
        tag: `pick-cancelled-${order.id}`,
        url: "/picking",
      });
    } catch (err) {
      console.error("[picking/cancel] push notify failed (non-fatal):", err);
    }
  }

  // `clearedAssignment` is information, not an error: 0 is the correct answer
  // for a bill cancelled before anyone was assigned to it.
  return NextResponse.json({ ok: true, orderId, clearedAssignment: cleared.count });
}
