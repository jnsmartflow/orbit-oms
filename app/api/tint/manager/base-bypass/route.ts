import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { checkAnyPermission } from "@/lib/permissions";
import { SUPPORT_DONE_OUTPUT } from "@/lib/workflow-stages";
import { TINT_STATUS_DONE } from "@/lib/tint/assignment-status";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// "Base — No Tint" — the bypass for a tint-classified OBD that needs NO tinting.
//
// A bill lands on the tint rail because import classified it `orderType="tint"`.
// Sometimes the whole bill is base/stock colour and there is nothing to mix. Up
// to now the only way past that was to assign it to a real operator who then
// walked it through Start → TI → Mark Done, inventing a Tinter Issue entry for
// work nobody did. This route does the same STATE TRANSITION without the theatre.
//
// It reproduces exactly what POST /api/tint/operator/done writes when a job
// finishes (app/api/tint/operator/done/route.ts:157-219) — same assignment
// fields, same IST completion-slot maths, same hasPresetSlot branch, same two
// audit rows — with three deliberate differences:
//
//   1. The assignment is attributed to the PLACEHOLDER worker, looked up by
//      email, never by a hardcoded id (see the block above the lookup).
//   2. `tint_logs.action` is "base_no_tint_bypass", NOT "completed", so the
//      audit trail can never confuse this with real tinting. The column is plain
//      nullable `text` with no CHECK and no enum (pg_constraint, read-only
//      2026-09-06: PK + 3 FKs only), so a new value is safe to add. Nine values
//      are already in use — assigned / started / completed / reassigned /
//      assignment_cancelled / split_created / split_cancelled / split_done /
//      split_started — and this is a tenth, not a reuse of any of them.
//   3. It writes NO tint_assignments.startedAt→completedAt gap worth reading,
//      no TI rows, and no sampling_usage_log rows (`done` writes one per TI;
//      there are no TIs here, so there is nothing to write).
//
// ⚠ SEQUENTIAL AWAITS, NEVER prisma.$transaction (CORE §3 — Vercel serverless +
// Supabase pooler times out). Partial state on a mid-sequence failure is
// acceptable and is handled the way assign/route.ts handles it: each step has
// its own catch, its own console.error naming the step, and its own 500 message
// telling the operator what did and did not land.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The placeholder worker's email — the STABLE key. Its numeric id is never
 * hardcoded anywhere: a reseed or a restore would renumber the row, and an
 * id-keyed lookup would then silently attribute bypasses to whoever inherited
 * that id. Email is UNIQUE on `users` (users_email_key), so findUnique is exact.
 *
 * The live row (verified read-only 2026-09-06) is deliberately inert:
 *   isActive=false  → kept out of the Assign dropdown, the Reports operator
 *                     chips, all three picker rosters, the attendance roster,
 *                     the attendance export and the nightly rollover cron, and
 *                     refused at sign-in by lib/auth.ts:210
 *   no user_roles   → invisible to /api/tint/manager/operators even if the
 *                     isActive filter ever changed (that query keys on the
 *                     junction table, not users.roleId)
 *   non-bcrypt pw   → bcrypt.compare can never return true for it
 *
 * 🔴 `isActive: false` is NOT checked below, and that is the point: assign/
 * route.ts:155-161 does not check it either, so an inactive user is a perfectly
 * valid `assignedToId`. That asymmetry is what makes this row usable as an
 * attribution target while staying invisible everywhere a person is listed.
 */
const PLACEHOLDER_EMAIL = "base-notint@system.invalid";

const bodySchema = z.object({
  orderId: z.number().int().positive(),
});

// Recognised business-rule errors map to 400 instead of 500 — the same shape,
// and the same reason, as assign/route.ts:17-18.
class BypassValidationError extends Error {}
const validationError = (msg: string): never => { throw new BypassValidationError(msg); };

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user tick, not a job title. Same gate as every other manager write on
  // this board; both superuser arms live inside checkAnyPermission.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "tint_manager", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { orderId } = parsed.data;
  // The acting human, from the session — never a hardcoded id. This is the
  // person who DECIDED no tinting was needed, and it is what both audit rows
  // record. Same derivation as assign/route.ts:39.
  const managerId = parseInt(session!.user.id, 10);

  // ── 1. Load the order and check it is bypassable ───────────────────────────
  const order = await prisma.orders.findFirst({
    where:  { id: orderId, isRemoved: false },
    select: {
      id:                 true,
      obdNumber:          true,
      orderType:          true,
      workflowStage:      true,
      customerMissing:    true,
      dispatchWindowId:   true,
      dispatchTargetDate: true,
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  try {
    if (order.orderType !== "tint") {
      validationError("This bill is not a tint order — there is nothing to bypass.");
    }

    // Block the bypass until customer master data exists — the same backstop
    // assign/route.ts:67-69 carries, in the same position among its guards and
    // with the same 400 shape. It matters MORE here, not less: a bypass sends
    // the bill straight on to the Floor rail (or to Picking on a pre-set slot),
    // so an unresolved ship-to would leave the depot holding a bill it cannot
    // deliver, with the tint step already closed behind it.
    //
    // ⚠ Unlike Assign, there is NO frontend interceptor chaining into
    // CustomerMissingSheet for this action, so this guard is the only thing
    // stopping it — not defence-in-depth, the actual gate.
    if (order.customerMissing) {
      validationError("Customer master data is missing for this order. Resolve in the Missing Customers sheet before marking it Base — No Tint.");
    }

    // The bypass writes a COMPLETED assignment out of thin air, so it is only
    // ever legitimate on a bill nobody holds yet. Once a real operator has been
    // assigned, the honest path is theirs: Send back to Pending first, then
    // bypass. Narrower than assign/route.ts's guard (which also accepts
    // `tint_assigned`) on purpose — accepting `tint_assigned` here would mint a
    // second, already-finished assignment alongside the operator's live one.
    if (order.workflowStage !== "pending_tint_assignment") {
      validationError(
        `This bill is at "${order.workflowStage}" and can no longer be marked Base — No Tint. Only a bill still waiting for an operator can be bypassed; send it back to Pending first.`,
      );
    }
  } catch (err) {
    if (err instanceof BypassValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  // ── 2. Resolve the placeholder worker — loudly ─────────────────────────────
  // If the row is absent the correct behaviour is to refuse and say so, NOT to
  // fall back to the acting manager: a bypass silently attributed to Chandresh
  // is indistinguishable from a job he actually tinted, which is the exact
  // confusion this whole feature exists to prevent.
  const placeholder = await prisma.users.findUnique({
    where:  { email: PLACEHOLDER_EMAIL },
    select: { id: true },
  });
  if (!placeholder) {
    console.error("[tint/manager/base-bypass] placeholder worker missing", {
      orderId, email: PLACEHOLDER_EMAIL,
    });
    return NextResponse.json(
      { error: "placeholder worker missing — contact admin" },
      { status: 500 },
    );
  }

  // ── 3. Completion slot — copied from done/route.ts:168-179 ─────────────────
  // IST wall clock, the same four thresholds as CLAUDE_CORE.md §9. Deliberately
  // duplicated rather than imported: done/route.ts declares it inline as an IIFE
  // and extracting it into a shared helper would be an edit to the live
  // Mark Done path, which is out of scope for this route.
  const completionSlotId = (() => {
    const now = new Date();
    const istStr = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
    const ist = new Date(istStr);
    const h = ist.getHours();
    const m = ist.getMinutes();
    const t = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    if (t < "10:30") return 1;
    if (t < "12:30") return 2;
    if (t < "15:30") return 3;
    return 4;
  })();

  // Same branch as done/route.ts:181. A slot pre-set at the desk (Floor's
  // change-slot) means the bill has already been decided for a dispatch window,
  // so completion flips it straight to Dispatch rather than returning it to the
  // Floor rail. CLAUDE_TINT.md §2.
  const hasPresetSlot = order.dispatchWindowId != null && order.dispatchTargetDate != null;
  const nextStage = hasPresetSlot ? SUPPORT_DONE_OUTPUT : "pending_support";
  const now = new Date();

  // ── 4a. The completed assignment row ───────────────────────────────────────
  // startedAt and completedAt are both `now`: the bypass has no duration, and a
  // null startedAt would read as "never started" to anything computing elapsed
  // time (lib/tint/elapsed-time.ts). accumulatedMinutes is left at its 0 default
  // — the honest figure for work that took no time.
  let assignmentId: number;
  try {
    const created = await prisma.tint_assignments.create({
      data: {
        orderId,
        assignedToId: placeholder.id,
        assignedById: managerId,
        status:       TINT_STATUS_DONE,
        startedAt:    now,
        completedAt:  now,
      },
      select: { id: true },
    });
    assignmentId = created.id;
  } catch (err) {
    console.error("[tint/manager/base-bypass] tint_assignments write failed", {
      orderId, step: "tint_assignments",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Failed to record the bypass" }, { status: 500 });
  }

  // ── 4b. Advance the order ──────────────────────────────────────────────────
  // Identical field set to done/route.ts:183-197. On the no-preset branch
  // `dispatchStatus` is deliberately NOT written — done leaves it alone there,
  // and clearing or setting it would stamp on a Hold or on a value enrichment
  // put there.
  try {
    await prisma.orders.update({
      where: { id: orderId },
      data: hasPresetSlot
        ? {
            workflowStage:  SUPPORT_DONE_OUTPUT,
            dispatchStatus: "dispatch",
            slotId:         completionSlotId,
            originalSlotId: completionSlotId,
          }
        : {
            workflowStage:  "pending_support",
            slotId:         completionSlotId,
            originalSlotId: completionSlotId,
          },
    });
  } catch (err) {
    console.error("[tint/manager/base-bypass] orders.update failed", {
      orderId, assignmentId, step: "orders.workflowStage",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Bypass recorded but the bill's stage did not move — please notify admin" },
      { status: 500 },
    );
  }

  // ── 4c. tint_logs (INSERT-ONLY — never skip) ───────────────────────────────
  try {
    await prisma.tint_logs.create({
      data: {
        orderId,
        action:        "base_no_tint_bypass",
        performedById: managerId,
        note:          "Base — No Tint: bill closed without tinting (no operator, no TI)",
      },
    });
  } catch (err) {
    console.error("[tint/manager/base-bypass] tint_logs.create failed", {
      orderId, assignmentId, step: "tint_logs",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Bypass applied but audit logging failed — please notify admin" },
      { status: 500 },
    );
  }

  // ── 4d. order_status_logs (INSERT-ONLY — never skip) ───────────────────────
  try {
    await prisma.order_status_logs.create({
      data: {
        orderId,
        fromStage:   "pending_tint_assignment",
        toStage:     nextStage,
        changedById: managerId,
        note:        "Base — No Tint (no tinting required)",
      },
    });
  } catch (err) {
    console.error("[tint/manager/base-bypass] order_status_logs.create failed", {
      orderId, assignmentId, step: "order_status_logs",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Bypass applied but audit logging failed — please notify admin" },
      { status: 500 },
    );
  }

  // Same success shape as assign/route.ts ({ success: true }), plus the two
  // facts a caller might want for its toast. The board refetches everything
  // through /api/tint/manager/orders anyway, so nothing here is load-bearing.
  return NextResponse.json({
    success:       true,
    obdNumber:     order.obdNumber,
    workflowStage: nextStage,
  });
}
