// lib/floor/bill-actions.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 ONE OWNER FOR THE PER-BILL STATE ACTIONS — Floor's and the Tint Manager's
// ═══════════════════════════════════════════════════════════════════════════
//
// Extracted VERBATIM from app/api/floor/actions/route.ts (2026-10-01, Tint
// Manager tabs build step 2 —
// docs/prompts/drafts/code-discovery-2026-10-01-tint-manager-build-plan.md §C).
// Floor's route keeps its body validation and its loop; the per-bill branch and
// the write block live here so the Tint Manager's route
// (app/api/tint/manager/actions) runs the SAME rule and the SAME writes instead
// of a copy. The only thing a caller chooses is `surface`, which picks the hold
// / clear-hold LOG NOTE — nothing else differs.
//
// Contract per bill, non-negotiable (CORE §3 + CLAUDE_PICKING §10):
//   - sequential awaits, never prisma.$transaction
//   - exactly ONE orders.update per bill (a second write fires a false "changed"
//     on every board's updatedAt live-sync marker)
//   - exactly ONE order_status_logs row per bill per action
//
// Server-only (Prisma).

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  FLOOR_HOLD_NOTE,
  FLOOR_CLEAR_HOLD_NOTE,
  TINT_HOLD_NOTE,
  TINT_CLEAR_HOLD_NOTE,
} from "@/lib/floor/hold-log";
import { FLOOR_CLEAR_HOLD_STAGES } from "@/lib/floor/release-stages";
import { buildDeskCancelNote, type DeskCancelReason } from "@/lib/floor/desk-cancel-reasons";
import { offFloorRefusal } from "@/lib/floor/off-floor";
import { findLiveCi, liveCiRefusal } from "@/lib/ci/live-ci";
import { billingRefusal } from "@/lib/billing/refusal";
import { stopTintWork } from "@/lib/tint/stop-work";
import { TINT_STATUS_DONE } from "@/lib/tint/assignment-status";

/** The log notes for the Hand mark (2026-09-24). Plain strings: nothing reads
 *  them back — the mark itself is orders.handAt. */
const HAND_SET_NOTE = "Hand — dealer collects";
const HAND_CLEAR_NOTE = "Hand cleared";

export type BillAction = "mark-urgent" | "change-slot" | "hold" | "cancel" | "restore" | "unhold" | "hand" | "unhand";
export const BILL_ACTIONS: BillAction[] = ["mark-urgent", "change-slot", "hold", "cancel", "restore", "unhold", "hand", "unhand"];

/** Who is pressing the button. Chooses the hold / clear-hold log note only. */
export type BillActionSurface = "floor" | "tint";

/** The order columns applyBillAction reads. A caller may select MORE (the Tint
 *  Manager adds `orderType`); never fewer. */
export const BILL_ACTION_ORDER_SELECT = {
  id: true,
  workflowStage: true,
  priorityLevel: true,
  obdEmailDate: true,
  dispatchStatus: true,
  isRemoved: true,
  // cancel (split cleanup) + restore (tint queue): tint bills only (2026-10-01).
  orderType: true,
  // hand / unhand: the repeat-press skip.
  handAt: true,
  // cancel's refusals (offFloorRefusal) — the trip number is for the message.
  tripDropId: true,
  tripDrop: { select: { trip: { select: { tripNumber: true } } } },
} satisfies Prisma.ordersSelect;

export type BillActionOrder = Prisma.ordersGetPayload<{ select: typeof BILL_ACTION_ORDER_SELECT }>;

/** Per-action inputs, already validated by the caller (see resolveChangeSlot). */
export interface BillActionOpts {
  /** mark-urgent: explicit set (bar). Omitted → per-bill toggle (row ⚡). */
  urgent?: boolean;
  /** change-slot: from resolveChangeSlot. */
  slot?: ResolvedSlot;
  /** cancel: a validated reason key, or null for the legacy note. */
  cancelReason?: DeskCancelReason | null;
  /** cancel: optional remark (trimmed, ≤ FLOOR_REMARK_MAX), after the label. */
  cancelRemark?: string | null;
  /** cancel: legacy free-text note, used only when cancelReason is absent. */
  reason?: string;
  /** cancel: lift offFloorRefusal's tint-room refusal. ONLY the Tint Manager's
   *  Stop & cancel passes it, after lib/tint/stop-work.ts has ended the live
   *  jobs (2026-10-01). Floor never does. */
  allowTintRoom?: boolean;
}

/** done = wrote one update + one log · failed = refused, nothing written ·
 *  skipped = hand/unhand repeat press, nothing written, not a failure. */
export type BillActionResult =
  /** toStage = the stage the bill is at now (2026-10-01: the Tint Manager's
   *  Restore says where the bill went). Floor ignores it. */
  | { kind: "done"; toStage: string }
  | { kind: "failed"; error: string }
  | { kind: "skipped" };

// ── change-slot input ──────────────────────────────────────────────────────

export interface ResolvedSlot {
  date: Date;
  dateStr: string;
  windowId: number;
  windowLabel: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseDateOnly(s: string): Date | null {
  if (!DATE_RE.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10) === s ? dt : null;
}

/** change-slot needs a valid date + window up front; resolves the window label
 *  once. The error strings are Floor's, unchanged (they are the 400 bodies). */
export async function resolveChangeSlot(
  dispatchTargetDate: unknown,
  dispatchWindowId: unknown,
): Promise<{ ok: true; slot: ResolvedSlot } | { ok: false; error: string }> {
  if (typeof dispatchWindowId !== "number" || !Number.isInteger(dispatchWindowId)) {
    return { ok: false, error: "dispatchWindowId is required for change-slot" };
  }
  const slotDate = typeof dispatchTargetDate === "string" ? parseDateOnly(dispatchTargetDate) : null;
  if (!slotDate) {
    return { ok: false, error: "dispatchTargetDate (YYYY-MM-DD) is required for change-slot" };
  }
  const win = await prisma.dispatch_slot_master.findUnique({ where: { id: dispatchWindowId }, select: { windowTime: true } });
  if (!win) return { ok: false, error: "dispatchWindowId does not resolve to a window" };
  return {
    ok: true,
    slot: { date: slotDate, dateStr: dispatchTargetDate as string, windowId: dispatchWindowId, windowLabel: win.windowTime },
  };
}

// ── The per-bill action ────────────────────────────────────────────────────

/**
 * Apply ONE action to ONE already-loaded, not-removed bill. Refusals come back
 * as `failed` (nothing written); a thrown error propagates to the caller's
 * catch, exactly as it did inside the Floor route's loop.
 */
export async function applyBillAction(
  order: BillActionOrder,
  action: BillAction,
  opts: BillActionOpts,
  changedById: number,
  surface: BillActionSurface,
): Promise<BillActionResult> {
  const orderId = order.id;

  // Unchecked update input so scalar FK writes (dispatchWindowId) are typed —
  // same shape the release route builds inline (CORE §3, no relation churn).
  let updateData: Prisma.ordersUncheckedUpdateInput;
  let toStage = order.workflowStage;
  let note: string;
  // Set by 'cancel' only — see the write block below. Declared here rather
  // than inside the branch because the writes are shared by all eight
  // actions and must stay in ONE place.
  let clearAssignment = false;

  if (action === "mark-urgent") {
    const newLevel = typeof opts.urgent === "boolean" ? (opts.urgent ? 1 : 3) : order.priorityLevel === 1 ? 3 : 1;
    updateData = { priorityLevel: newLevel };
    note = newLevel === 1 ? "Marked urgent (P1)" : "Cleared urgent";
  } else if (action === "change-slot") {
    const slot = opts.slot;
    if (!slot) throw new Error("change-slot called without a resolved slot");
    updateData = { dispatchTargetDate: slot.date, dispatchWindowId: slot.windowId, dispatchSlotSource: "manual" };
    note = `Dispatch slot changed to ${slot.dateStr} ${slot.windowLabel}`;
  } else if (action === "hold") {
    if (order.workflowStage === "cancelled") {
      return { kind: "failed", error: "Cannot hold a cancelled bill" };
    }
    // heldAt anchors the hold footprint to the ARRIVAL date, not wall-clock
    // (CLAUDE_FLOOR.md §4.5 — the read-side rule; convention inherited from
    // the retired Support board). Same convention every hold path uses.
    updateData = { dispatchStatus: "hold", heldAt: order.obdEmailDate ?? new Date() };
    // The note is the ONLY thing that identifies this as a hold event —
    // toStage deliberately stays the order's unchanged workflowStage. Shared
    // constants with the reader (getFloorHold, via HOLD_LOG_NOTES) so the two
    // cannot drift.
    note = surface === "tint" ? TINT_HOLD_NOTE : FLOOR_HOLD_NOTE;
  } else if (action === "hand" || action === "unhand") {
    // HAND — the dealer collects from the depot (2026-09-24, design
    // web-update-2026-09-24-billing-mo-actions.md §4). A timestamp + actor,
    // 🔴 NEVER a dispatchStatus value: every board predicate pins 'dispatch'.
    // The refusals are billing's own rule (lib/billing/refusal.ts):
    // dispatched, cancelled or ON A TRIP refused — clearing too, so a bill on
    // a Hand trip is taken off the trip first; tint room and picked allowed.
    const setting = action === "hand";
    const refusal = billingRefusal(
      "hand",
      {
        workflowStage: order.workflowStage,
        isRemoved: order.isRemoved,
        tripDropId: order.tripDropId,
        tripNumber: order.tripDrop?.trip.tripNumber ?? null,
      },
      setting ? "set" : "clear",
    );
    if (refusal !== null) {
      return { kind: "failed", error: refusal };
    }
    if (setting === (order.handAt !== null)) {
      return { kind: "skipped" };
    }
    updateData = setting ? { handAt: new Date(), handById: changedById } : { handAt: null, handById: null };
    note = setting ? HAND_SET_NOTE : HAND_CLEAR_NOTE;
  } else if (action === "cancel") {
    // 🔴 THE SAME REFUSALS AS RAISE CI (lib/floor/off-floor.ts, owner
    // 2026-09-22): already cancelled, dispatched, on a trip, or in the tint
    // room. Per bill, into `failed`, never the whole batch.
    const refusal = offFloorRefusal(
      {
        workflowStage: order.workflowStage,
        tripDropId: order.tripDropId,
        tripNumber: order.tripDrop?.trip.tripNumber ?? null,
      },
      { allowTintRoom: opts.allowTintRoom === true },
    );
    if (refusal !== null) {
      return { kind: "failed", error: refusal };
    }
    // 🔴 TINT BILLS: CANCEL ANY LIVE SPLITS FIRST (2026-10-01, Tint Manager tabs
    // build step 3 — plan §D, owner-approved). A partly-split bill sits at
    // pending_tint_assignment while legacy splits are still live; cancelling the
    // bill used to leave them in the operator's queue, workable, and able to
    // write slotId onto the cancelled parent at Done. lib/tint/stop-work.ts owns
    // the split cancel (no orders write; idempotent). BEFORE the stage write, so
    // a failure here leaves the bill un-cancelled with nothing orphaned, and the
    // same press heals it. A bill with no live split writes nothing here.
    if (order.orderType === "tint") {
      await stopTintWork({
        orderId,
        managerId: changedById,
        note: "bill cancelled",
        parts: { assignments: false, splits: true },
      });
    }
    updateData = { workflowStage: "cancelled", dispatchStatus: null };
    toStage = "cancelled";
    // With a reason key: the desk note builder (lib/floor/desk-cancel-reasons.ts,
    // Picking's note shape), so the Cancelled tab reads
    // "Cancelled — Pick delete · {remark}" exactly as a picking cancel does.
    const cancelReason = opts.cancelReason ?? null;
    note =
      cancelReason !== null
        ? buildDeskCancelNote(cancelReason, opts.cancelRemark ?? null)
        : opts.reason
          ? `Cancelled — ${opts.reason}`
          : "Cancelled from floor";
    // 🔴 ORPHAN FIX (2026-08-20). Since 2026-09-22 cancel REFUSES a bill that
    // is already cancelled, dispatched, on a trip, or in the tint room
    // (offFloorRefusal above) — but every other stage is allowed, including
    // pick_assigned / pick_done / pick_checked. Before the fix it left the
    // pick_assignments row behind on those, because this branch only ever
    // wrote to `orders`.
    //
    // That row is a trap, not just litter. A cancelled bill can be Restored
    // (the 'restore' arm below) to pending_support, then Released to
    // pending_picking — at which point app/api/picking/assign/route.ts's
    // guard (c) finds the surviving row and rejects with "Already
    // assigned." FOREVER: `pick_assignments.orderId` is @unique and the
    // ONLY deleter is app/api/picking/unassign/route.ts, which requires
    // workflowStage === PICK_ASSIGNED — a stage the bill can never reach
    // again. The bill is permanently un-assignable while the UI claims it
    // is assigned to nobody.
    //
    // Clearing it also stops the row asserting a false present tense: once
    // the order is dead, "Ramesh is picking this" is not true. Who held it
    // survives on the assign event in order_status_logs, which is the right
    // home for history.
    clearAssignment = true;
  } else if (action === "restore") {
    // restore — cancelled → back onto the board as a `no slot` row, through
    // floorBoardWhere's arm 2 (floorUnslottedWhere: rank < 60 +
    // dispatchStatus null; the decision rail this once fed retired
    // 2026-09-13) — or, for a tint bill that never finished, back onto the
    // Tint Manager rail (below). Splits a cancel ended stay cancelled; the next
    // Assign mints a fresh job.
    if (order.workflowStage !== "cancelled") {
      return { kind: "failed", error: "Order is not cancelled" };
    }
    // 🔴 A BILL WITH A LIVE CI IS NOT RESTORED (2026-09-22). Its return is on
    // billing's desk; putting it back on the floor would send the goods out
    // while billing books them back in. ANY source — a floor CI, a hand-raised
    // one, an auto one. A draft is an in-flight write, invisible everywhere
    // (CLAUDE_CI §2), and does not count.
    const liveCi = await prisma.ci_returns.findFirst({
      where: { orderId, isVoided: false, status: { not: "draft" } },
      orderBy: { id: "asc" },
      select: { id: true, ciNumber: true },
    });
    if (liveCi !== null) {
      return {
        kind: "failed",
        error: `Return ${liveCi.ciNumber ?? `CI #${liveCi.id}`} is with billing — it can't be restored here`,
      };
    }
    // 🔴 A TINT BILL THAT NEVER FINISHED TINTING GOES BACK TO THE TINT QUEUE
    // (owner 2026-10-01, plan §J-1). "Never finished" = no tint_assignments row
    // at TINT_STATUS_DONE (any assignee — the Base placeholder counts, its
    // bypass IS a finish) and no split at TINT_STATUS_DONE. Its shades were
    // never made, so pending_support would send it past the tint room. A tint
    // bill cancelled AFTER finishing keeps the floor's pending_support. Same
    // destination Pick-delete Undo uses (lib/billing/pick-delete.ts).
    let neverTinted = false;
    if (order.orderType === "tint") {
      const doneAssignments = await prisma.tint_assignments.count({ where: { orderId, status: TINT_STATUS_DONE } });
      const doneSplits = doneAssignments > 0 ? 0 : await prisma.order_splits.count({ where: { orderId, status: TINT_STATUS_DONE } });
      neverTinted = doneAssignments === 0 && doneSplits === 0;
    }
    if (neverTinted) {
      updateData = { workflowStage: "pending_tint_assignment", dispatchStatus: null, sequenceOrder: 0 };
      toStage = "pending_tint_assignment";
      note = "Restored to tint queue";
    } else {
      updateData = { workflowStage: "pending_support", dispatchStatus: null };
      toStage = "pending_support";
      note = "Restored to decisions";
    }
  } else {
    // unhold (2026-09-22) — the 8 s Undo on the bottom bar's bulk Hold; the
    // Tint Manager's Release (2026-10-01). Puts back the ONE thing hold
    // changed: `dispatchStatus`. Stage, slot, trip and pick assignment were
    // never written by hold, so they are still exactly as they were. `heldAt`
    // is left alone, as Release leaves it (it is the arrival date,
    // CLAUDE_FLOOR §4.5).
    //
    // 🔴 THE STATUS IS DERIVED FROM THE STAGE, NEVER TAKEN FROM THE CALLER.
    // A stage the bill reached by being sent to the floor
    // (FLOOR_CLEAR_HOLD_STAGES) gets "dispatch" back. Anything else —
    // pending_support and the tint stages — gets NULL: "dispatch" on those
    // leaves a bill no screen shows (release-stages.ts, the
    // pending_support note).
    if (order.dispatchStatus !== "hold") {
      return { kind: "failed", error: "Bill is not on hold" };
    }
    // 🔴 A bill carrying a LIVE CI stays held (2026-09-24, design
    // web-update-2026-09-24-billing-mo-actions.md §3.7) — unhold would put a
    // bill-only bill back toward picking. Finish it with Cancel instead.
    const liveCi = await findLiveCi(orderId);
    if (liveCi !== null) {
      return { kind: "failed", error: liveCiRefusal(liveCi, "released") };
    }
    updateData = {
      dispatchStatus: FLOOR_CLEAR_HOLD_STAGES.includes(order.workflowStage) ? "dispatch" : null,
    };
    // ⚠ NOT a hold note — both clear notes are kept OUT of HOLD_LOG_NOTES so
    // a re-held bill's "held since" is its new hold.
    note = surface === "tint" ? TINT_CLEAR_HOLD_NOTE : FLOOR_CLEAR_HOLD_NOTE;
  }

  // ONE orders.update per bill.
  await prisma.orders.update({ where: { id: orderId }, data: updateData });
  // Cancel only — clear the assignment AFTER the stage write, never before.
  // Same ordering rule as app/api/picking/unassign/route.ts: if this fails,
  // the order is cancelled with a stale row (a fixable leftover, and the
  // state every cancel produced before this fix). Reversed, a failed stage
  // write would delete the assignment record while the bill was still
  // pick_assigned — on the picker's board with no record of who has it, and
  // unrecoverable via unassign. deleteMany tolerates the common case of no
  // row at all. Touches neither `orders` nor `order_status_logs`, so the
  // one-update / one-log contract above is unchanged and the live-sync
  // marker sees exactly one change.
  if (clearAssignment) {
    await prisma.pick_assignments.deleteMany({ where: { orderId } });
  }
  // ONE log per bill per action.
  await prisma.order_status_logs.create({
    data: { orderId, fromStage: order.workflowStage, toStage, changedById, note },
  });

  return { kind: "done", toStage };
}
