// Floor Control — taking a bill OFF the floor: Cancel and Raise CI (2026-09-22).
//
// Two things live here, both shared by the two write routes that remove a bill
// from the floor — `POST /api/floor/actions` (cancel) and `POST /api/floor/ci`
// (raise a full-bill CI):
//
//   1. FLOOR_CANCEL_REASONS — which cancel reasons the floor may give.
//   2. offFloorRefusal()    — which bills neither route may touch, and why.
//
// Pure: no Prisma, no React, no clock. The step-5b form imports both, so what
// it offers and greys out is what the routes accept and refuse.
//
// ── The reasons ─────────────────────────────────────────────────────────────
// 🔴 THE DESK LIST (owner decision B, 2026-10-01). Floor's and the Tint
// Manager's cancel forms offer lib/floor/desk-cancel-reasons.ts — Pick delete ·
// Customer cancelled · Wrong order by SO · Duplicate bill · Material short ·
// Other. It used to be a one-reason SUBSET of Picking's list; it became its own
// list because Picking's cancel sheet renders Picking's list whole and must not
// change. The names below are kept so every existing import still resolves;
// they now point at the desk list. The note shape is still Picking's
// (buildDeskCancelNote derives it from buildCancelNote), so parseCancelNote
// below reads both.

import { CANCEL_REASON_LABELS, CANCEL_NOTE_MAX, buildCancelNote, type CancelReason } from "@/lib/picking/cancel-reasons";
import {
  DESK_CANCEL_REASONS,
  DESK_CANCEL_REASON_OPTIONS,
  isDeskCancelReason,
  type DeskCancelReason,
} from "@/lib/floor/desk-cancel-reasons";

/** The cancel reasons the desks may give, in display order (the desk list). */
export const FLOOR_CANCEL_REASONS: readonly DeskCancelReason[] = DESK_CANCEL_REASONS;

export function isFloorCancelReason(value: unknown): value is DeskCancelReason {
  return isDeskCancelReason(value);
}

/** {value,label} pairs for the forms, in FLOOR_CANCEL_REASONS order. */
export const FLOOR_CANCEL_REASON_OPTIONS: { value: DeskCancelReason; label: string }[] = DESK_CANCEL_REASON_OPTIONS;

/** The remark cap — Picking's constant, so the two cancel forms agree. Also
 *  used for the CI remark (ci_returns.reasonRemark) on the floor. */
export const FLOOR_REMARK_MAX = CANCEL_NOTE_MAX;

// ── The refusals ────────────────────────────────────────────────────────────

/** The ONE wording for "an operator holds this bill" (2026-10-01). Read by
 *  offFloorRefusal below AND by lib/billing/refusal.ts (Billing's CI), so the two
 *  desks name the same remedy — the Tint Manager's Stop & cancel. */
export const TINT_ROOM_REFUSAL = "In the tint room — use Stop & cancel on Tint Manager";

/** What offFloorRefusal needs to know about a bill. */
export interface OffFloorBill {
  workflowStage: string;
  tripDropId: number | null;
  /** The trip's number when the bill is on one — for the message. */
  tripNumber: string | null;
}

/**
 * Why this bill may NOT be cancelled or CI'd from the floor, or null when it
 * may. Per bill, reported, never a batch failure (owner, 2026-09-22).
 *
 * 🔴 ON A TRIP → REFUSED, NOT DETACHED. The cancel never clears `tripDropId`
 * (one orders.update, stage + status only), and a cancelled bill left on a
 * trip stops that trip ever reading READY (lib/trips/queries.ts isReady). The
 * planner takes it off the trip first — a trip action, on the trip side.
 *
 * 🔴 IN THE TINT ROOM → REFUSED. At `tint_assigned` / `tinting_in_progress` an
 * operator holds an active tint_assignments row that a floor cancel would
 * orphan. `pending_tint_assignment` has no operator yet and IS allowed.
 *
 * ⚠ NOT the retired detail-panel tint lock (CLAUDE_FLOOR §4.7, inert since
 * the rail went). That was a UI gate on `source === "rail"`; this is enforced
 * by the routes themselves.
 *
 * `allowTintRoom` (2026-10-01, Tint Manager tabs build step 3) lifts ONLY the
 * tint-room refusal. Passed ONLY by the Tint Manager's Stop & cancel and its
 * mid-tint Raise CI, and only AFTER lib/tint/stop-work.ts has ended the live
 * assignment and splits — so the orphan this refusal exists to prevent cannot
 * happen. Floor never passes it.
 */
export function offFloorRefusal(bill: OffFloorBill, opts?: { allowTintRoom?: boolean }): string | null {
  if (bill.workflowStage === "cancelled") return "Already cancelled";
  if (bill.workflowStage === "dispatched") return "Already dispatched";
  if (bill.tripDropId !== null) {
    return `On trip ${bill.tripNumber ?? "(unknown)"} — remove it from the trip first`;
  }
  if (
    opts?.allowTintRoom !== true &&
    (bill.workflowStage === "tint_assigned" || bill.workflowStage === "tinting_in_progress")
  ) {
    return TINT_ROOM_REFUSAL;
  }
  return null;
}

// ── Reading a cancel note back (the Cancel & CI tab, 2026-09-22) ─────────────

// 🔴 THE NOTE'S SHAPE IS buildCancelNote's, AND IT IS READ FROM THERE — not
// retyped. The prefix ("Cancelled — ") and the remark separator (" · ") are
// derived once from what the builder actually writes, so a change to the
// builder moves the parser with it.
const PROBE_KEY: CancelReason = "other";
const PROBE_BASE = buildCancelNote(PROBE_KEY);
const NOTE_PREFIX = PROBE_BASE.slice(0, PROBE_BASE.length - CANCEL_REASON_LABELS[PROBE_KEY].length);
const NOTE_SEPARATOR = buildCancelNote(PROBE_KEY, "x").slice(PROBE_BASE.length, -1);

/**
 * Split a cancel log note into the reason and the remark for display.
 *
 *   "Cancelled — {Label} · {remark}" → { reason: Label, remark }
 *   "Cancelled — {Label}"            → { reason: Label, remark: null }
 *   anything else ("Cancelled from floor", a Support-era note …)
 *                                    → { reason: note,  remark: null }
 *
 * Display only — never parsed back into a key. Old free-text floor notes
 * ("Cancelled — {text}") read as a reason, which is what they were.
 */
export function parseCancelNote(note: string | null): { reason: string | null; remark: string | null } {
  if (note === null || note.trim() === "") return { reason: null, remark: null };
  if (!note.startsWith(NOTE_PREFIX)) return { reason: note, remark: null };
  const rest = note.slice(NOTE_PREFIX.length);
  const at = rest.indexOf(NOTE_SEPARATOR);
  if (at < 0) return { reason: rest, remark: null };
  const remark = rest.slice(at + NOTE_SEPARATOR.length).trim();
  return { reason: rest.slice(0, at), remark: remark === "" ? null : remark };
}
