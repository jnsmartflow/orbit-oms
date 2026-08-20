import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { SUPPORT_DONE_OUTPUT, PICK_ASSIGNED, PICK_DONE } from "@/lib/workflow-stages";
import { buildCancelNote, isCancelReason, CANCEL_NOTE_MAX } from "@/lib/picking/cancel-reasons";

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

/**
 * Stages this route will cancel from.
 *
 * ⚠ EXPORTED so the 3b reason sheet can gate its own affordance on the SAME
 * list rather than hard-coding stage names in a component — the standing rule
 * from CLAUDE_PICKING.md §7 (every stage decision asks one owner).
 *
 * ⚠ DELIBERATELY NARROWER THAN FLOOR, and this is the one place the two
 * surfaces diverge. Floor's cancel branch refuses ONLY an already-cancelled
 * bill, so it can (and today will) cancel at `pick_checked` and even
 * `dispatched`. This route refuses both:
 *   - `pick_checked` — a supervisor has already ticked every line and signed
 *     off. Cancelling it erases a completed check from every live board.
 *   - `dispatched`   — the goods have left.
 * Refusing is the recoverable direction: Floor can still do it if a real case
 * appears, and this list is one edit away from admitting them. Permitting by
 * default is not recoverable — the log row is INSERT-ONLY.
 *
 * `pick_done` IS admitted even though the goods are physically staged, because
 * refusing it would leave the floor with no way to kill a bill that a customer
 * cancelled while it sat on the staging bench. The UI decides whether to OFFER
 * it there; this route is the backstop, not the policy.
 */
export const PICKING_CANCELLABLE_STAGES: string[] = [
  SUPPORT_DONE_OUTPUT, // pending_picking — the Assign tab. Nobody holds it.
  PICK_ASSIGNED,       // a picker has it — the assignment row is cleared below.
  PICK_DONE,           // picked, awaiting check.
];

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

  // a. Fetch the order.
  const order = await prisma.orders.findFirst({
    where: { id: orderId },
    select: { id: true, workflowStage: true, isRemoved: true },
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

  // `clearedAssignment` is information, not an error: 0 is the correct answer
  // for a bill cancelled before anyone was assigned to it.
  return NextResponse.json({ ok: true, orderId, clearedAssignment: cleared.count });
}
