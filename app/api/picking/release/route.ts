import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { SUPPORT_DONE_OUTPUT } from "@/lib/workflow-stages";
// The early-release WINDOW rule — last working day before dispatch, Sunday
// skipped, holidays not modelled. Pure and clock-free (the day is passed in),
// so this route and the board ask the identical question of the identical
// function and can never disagree about the answer.
import { isReleasableToday, previousWorkingDateOnlyUTC } from "@/lib/picking/release-window";

export const dynamic = "force-dynamic";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Today in IST as a UTC-midnight Date — the SAME shape and the SAME
 * derivation lib/picking/queue.ts:getISTTodayDate() uses. Deliberately
 * duplicated rather than approximated: if this route computed "today" any
 * other way, it could disagree with the queue's own zone classification
 * across the IST/UTC day boundary and 409 a bill the board is showing as
 * locked (or release one the board already shows as due).
 */
function getISTTodayDateOnly(): Date {
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  return new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()));
}

/**
 * "2026-09-07" -> "Mon 07 Sep", for the window 409's message.
 *
 * A deliberate MIRROR of formatDispatchDay() in
 * components/picking/picking-board-mobile.tsx — same "en-GB" pin, same
 * timeZone:"UTC", same weekday/day/month assembly, so the day this route names
 * in an error reads identically to the day the card badge and the release sheet
 * print. Same call this file already made for getISTTodayDateOnly above:
 * the client copy lives in a "use client" component and cannot be imported
 * here, and a formatter is not worth a shared module for one string.
 *
 * Parsed by regex into Date.UTC(y, m-1, d), never `new Date(str)` — CORE §3.
 * Returns the raw input if it is somehow malformed, so a message degrades to a
 * plain date rather than "Invalid Date".
 */
function formatReleaseDay(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const [, y, mo, d] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (Number.isNaN(dt.getTime())) return isoDate;
  const opts = { timeZone: "UTC" } as const;
  const weekday = dt.toLocaleDateString("en-GB", { ...opts, weekday: "short" });
  const month = dt.toLocaleDateString("en-GB", { ...opts, month: "short" });
  return `${weekday} ${d} ${month}`;
}

/**
 * POST /api/picking/release — manual early release of a future-dated
 * ("upcoming") bill so it can be assigned today. Body: { orderId }.
 *
 * This does NOT touch workflowStage. The bill stays at `pending_picking`;
 * only its ZONE changes, because lib/picking/queue.ts classifies a released
 * bill as "due" regardless of its dispatch date. No new stage, no new
 * pick_assignments.status value — so chk_pick_assignments_status (the live
 * CHECK constraint invisible in schema.prisma, CLAUDE_PICKING.md §7) is not
 * involved. Same modelling call as Checked/Approved: timestamp + actor
 * columns, never a new status string.
 *
 * The automatic midnight unlock is unaffected and remains the normal path —
 * this is the override for "we need it on the truck today".
 *
 * ⚠ THE WINDOW RULE LIVES HERE, NOT ON THE BOARD (2026-09-07). Early release
 * is offered only on the LAST WORKING DAY before the dispatch date. The card's
 * lock and the sheet's two modes read `PickingQueueRow.releasableToday`, which
 * this same lib/picking/release-window.ts rule computed server-side — but a
 * board left open past midnight carries a stale answer, and nothing stops a
 * direct POST, so the gate below is the enforcement and the UI is convenience.
 *
 * GUARD ORDER IS LOAD-BEARING — do not reorder:
 *   permission -> dispatchStatus -> workflowStage -> not-future -> WINDOW
 *   -> already-released
 * The already-released 409 stays LAST so a double-tap on a bill that IS in its
 * window still reports "already released", never "too early".
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // canEdit, not canView (2026-07-20 gate correction — see the note in
  // app/api/picking/assign/route.ts). Releasing a bill early overrides a
  // dispatch date Support set deliberately; it is a supervisor action.
  // `picker` holds canView on 'picking' so its own board renders, and must
  // NOT be able to reach this route.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "picking", "canEdit");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Who actually performed this — the real session, never a request body
  // claim (approve/route.ts's rule). Number("") is 0 and finite, so test for
  // a real positive integer rather than Number.isFinite.
  const releasedById = Number(session.user.id);
  if (!Number.isInteger(releasedById) || releasedById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { orderId?: number };
  const orderId = body.orderId;
  if (typeof orderId !== "number" || !Number.isInteger(orderId)) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  const order = await prisma.orders.findFirst({
    where: { id: orderId },
    select: {
      id: true,
      workflowStage: true,
      dispatchStatus: true,
      dispatchTargetDate: true,
      isRemoved: true,
      pickEarlyReleasedAt: true,
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.isRemoved) {
    return NextResponse.json({ error: "Order has been removed." }, { status: 409 });
  }

  // Must be a bill the picking queue would actually show. Both predicates
  // mirror getPickingQueue()'s WHERE exactly — releasing something the board
  // cannot display would stamp a record nobody ever sees.
  if (order.dispatchStatus !== "dispatch") {
    return NextResponse.json({ error: "Order is not dispatch-released." }, { status: 409 });
  }
  // Only a WAITING bill can be released. Once assigned/picked/checked the
  // lock is moot and a release would be a confusing no-op record.
  if (order.workflowStage !== SUPPORT_DONE_OUTPUT) {
    return NextResponse.json({ error: "Order is not waiting to be assigned." }, { status: 409 });
  }

  // Must genuinely BE upcoming. A null or past/today date is already "due",
  // so there is nothing to unlock — refuse rather than stamp a meaningless
  // release that would then show a "released" chip on a bill that was never
  // locked.
  const today = getISTTodayDateOnly();
  if (order.dispatchTargetDate === null || order.dispatchTargetDate.getTime() <= today.getTime()) {
    return NextResponse.json({ error: "Order is not future-dated — nothing to release." }, { status: 409 });
  }

  // ── THE WINDOW GATE — THIS IS THE AUTHORITATIVE RULE ────────────────────
  // A supervisor may release an upcoming bill only on the LAST WORKING DAY
  // before its dispatch date (Sunday skipped; holidays not modelled). The
  // board's own lock is convenience — a stale board left open past midnight,
  // or a direct POST, both land here, and here is where the rule actually
  // holds.
  //
  // Both dates come from the values this route ALREADY has: `today` is the
  // getISTTodayDateOnly() Date computed above, sliced; `dispatchTargetIso` is
  // the @db.Date column sliced the same way. NO second clock read, and no
  // Date parsing of a string anywhere (CORE §3's offset-less-parse rule) —
  // lib/picking/release-window.ts works in date-only ISO strings end to end.
  //
  // ORDER IS LOAD-BEARING: this sits AFTER the not-future 409 (so that one
  // keeps its own wording for a null/past date) and BEFORE the
  // already-released 409 (so a double-tap on a legitimately releasable bill
  // still reports "already released", never "too early").
  const todayIso = today.toISOString().slice(0, 10);
  const dispatchTargetIso = order.dispatchTargetDate.toISOString().slice(0, 10);
  if (!isReleasableToday(dispatchTargetIso, todayIso)) {
    // Name the day rather than only refusing — the supervisor's next question
    // is always "then when?", and a bare "too early" sends him hunting.
    const opensOn = formatReleaseDay(previousWorkingDateOnlyUTC(dispatchTargetIso));
    return NextResponse.json(
      { error: `Too early — this bill can be released from ${opensOn}.` },
      { status: 409 },
    );
  }

  // Idempotency / double-tap guard, same shape as approve/route.ts's 409:
  // the first successful call sets pickEarlyReleasedAt, so a retry lands
  // here before any write and cannot overwrite the original actor/time.
  if (order.pickEarlyReleasedAt !== null) {
    return NextResponse.json({ error: "Order was already released early." }, { status: 409 });
  }

  // Sequential awaits only — never prisma.$transaction (CORE §3). Unlike
  // assign/approve there is no two-write ordering hazard here: both columns
  // land in ONE row update, so the release is atomic on its own. If the
  // audit insert below then fails, the release stands and one log line is
  // missing — the correct direction to fail (the bill is usable; the trail
  // is repairable), and the opposite of what a stage advance would risk.
  await prisma.orders.update({
    where: { id: orderId },
    data: { pickEarlyReleasedAt: new Date(), pickEarlyReleasedById: releasedById },
  });

  // Audit reuses order_status_logs with a pseudo-stage in toStage — the same
  // pattern the Hide feature uses (ORDER_HIDDEN / ORDER_UNHIDDEN,
  // CLAUDE_CORE.md §7.10). Safe because this table is INSERT-ONLY audit and
  // is never read back through stageRank(); fromStage carries the real,
  // unchanged stage so the row still says where the bill actually was.
  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage: order.workflowStage,
      toStage: "PICK_EARLY_RELEASED",
      changedById: releasedById,
      note: `Released early for picking by user #${releasedById} (was scheduled ${dispatchTargetIso})`,
    },
  });

  return NextResponse.json({ ok: true, orderId });
}
