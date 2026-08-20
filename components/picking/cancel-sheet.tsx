"use client";

// ── Cancel-bill reason sheet — SUPERVISOR BOARD ONLY ───────────────────────
// Opened from the ⋯ in the DETAIL SCREEN's own teal header
// (picking-board-mobile.tsx). Never from a list card: the Assign card's whole
// body is the select target (no checkbox, CLAUDE_UI.md §62), and a destructive
// control one mistap from a select gesture was explicitly rejected.
//
// ⚠ NOT SHARED WITH THE PICKER FACE. picker-my-picks-board.tsx has no cancel
// and must not gain one — a picker fetching goods does not kill orders. This
// file lives under components/picking/ beside the other supervisor-only pieces
// rather than in components/shared/.
//
// It lives in its OWN file, unlike the board's two other sheets (the picker
// sheet and the release-confirm), which are inline JSX. Those are ~20 and ~55
// lines; this one carries two stages, five radio rows, a counted textarea and
// three stage-dependent banners, and picking-board-mobile.tsx is already 3,000
// lines. The prop contract below is the whole seam — this component knows
// nothing about the board's lists, history stack, or refetch.
//
// SHEET SHAPE — CLAUDE_UI.md §55: fixed inset-0 flex items-end, bg-black/40
// backdrop, rounded-t panel, safe-area paddingBottom. A bottom sheet, never a
// centre modal.
//
// ⚠ SAFE-AREA FLOOR, NOT MOBILE_NAV_CLEARANCE. The board's other two sheets sit
// over the LIST, where the bottom tab bar is visible, so they offset by
// SHEET_GEOMETRY.bottomOffset. This one sits over the DETAIL screen, where the
// shell's `hideBar` has removed that bar entirely (CLAUDE_PICKING.md §5.3) —
// so it uses the plain /po safe-area floor, exactly as the three detail CTAs
// do. Offsetting by the nav clearance here would float it 76px above nothing.
//
// 🔴 NO TEAL ANYWHERE IN THIS SHEET. Teal is the board's primary-action colour
// and this sheet has no primary action worth encouraging. Red is the confirm,
// and only there. Disabled is GREY, never a faded red (CLAUDE_UI.md §10 — a
// faded primary reads as broken, not as waiting).

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { PickingQueueRow } from "@/lib/picking/types";
import { PICK_ASSIGNED, PICK_DONE } from "@/lib/workflow-stages";
import {
  CANCEL_NOTE_MAX,
  CANCEL_REASON_OPTIONS,
  cancelRequiresNote,
  type CancelReason,
} from "@/lib/picking/cancel-reasons";

// Above the detail screen (z-[35]) and matching the board's own sheet layers.
const SCRIM_Z = "z-[65]";
const PANEL_Z = "z-[75]";

function formatLitres(v: number | null): string {
  if (v === null) return "—";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function CancelSheet({
  row,
  stage,
  lineCount,
  busy,
  onClose,
  onConfirm,
}: {
  row: PickingQueueRow;
  /** The bill's workflow stage, from pickingRowStage() — the ONE mapping owner
   *  (lib/workflow-stages.ts). Drives the banner and the two-stage gate. */
  stage: string;
  /** Lines on the open bill, already loaded by the detail screen. null while
   *  they are still fetching — the summary line just omits the count. */
  lineCount: number | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: CancelReason, note: string) => void;
}): React.JSX.Element {
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [note, setNote] = useState("");
  // Stage 2 is the pick_done second screen ONLY (PART 3 / CLAUDE_UI.md §13).
  const [confirming, setConfirming] = useState(false);

  const isAssignedStage = stage === PICK_ASSIGNED;
  const isDoneStage = stage === PICK_DONE;

  // Confirm is live once a reason is chosen — and, for a reason that demands
  // one, once a remark exists. cancelRequiresNote() is imported rather than
  // re-testing `reason === "other"`: the ROUTE enforces the rule with a 400,
  // this only greys the button so nobody ever reaches it.
  const noteOk = reason === null || !cancelRequiresNote(reason) || note.trim().length > 0;
  const canConfirm = reason !== null && noteOk && !busy;

  const remaining = CANCEL_NOTE_MAX - note.length;

  function handlePrimary(): void {
    if (!canConfirm || reason === null) return;
    // pick_done gets the second screen; every other stage fires on this tap.
    if (isDoneStage && !confirming) {
      setConfirming(true);
      return;
    }
    onConfirm(reason, note);
  }

  return (
    <div className={`fixed inset-0 flex items-end ${SCRIM_Z}`} role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => {
          if (!busy) onClose();
        }}
        aria-hidden="true"
      />
      <div
        className={`relative ${PANEL_Z} w-full max-h-[85vh] overflow-y-auto rounded-t-[18px] bg-white px-5 pt-4`}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)" }}
      >
        <div className="mx-auto mb-3.5 h-1 w-9 rounded-full bg-gray-300" />

        {confirming ? (
          /* ── STAGE 2 — pick_done only (CLAUDE_UI.md §13 two-stage confirm) ──
             The goods are already off the shelf. Nothing in this system tells
             anyone to put them back, so the put-away is a human errand the
             supervisor has to arrange — saying so is the entire point of this
             screen. */
          <>
            <h3 className="text-[17px] font-extrabold leading-snug text-gray-900">
              Goods are already picked
            </h3>
            <div className="mt-3 rounded-[12px] border border-red-200 bg-red-50 px-3.5 py-3">
              <div className="flex gap-2">
                <AlertTriangle size={15} className="mt-[1px] shrink-0 text-red-600" />
                <p className="text-[12.5px] leading-relaxed text-red-800">
                  This material is off the shelf and staged on the floor. Cancelling the bill tells
                  nobody to put it back — <b className="font-bold">arrange the put-away first</b>,
                  then cancel.
                </p>
              </div>
            </div>
            <div className="mt-[18px] flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="h-12 flex-1 rounded-full border border-gray-200 bg-white text-[14.5px] font-bold text-gray-700 active:bg-gray-50 disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handlePrimary}
                disabled={!canConfirm}
                className={
                  "h-12 flex-1 rounded-full text-[14.5px] font-bold " +
                  (canConfirm
                    ? "bg-red-600 text-white active:bg-red-700"
                    : "cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400")
                }
              >
                {busy ? "Cancelling…" : "Yes, cancel bill"}
              </button>
            </div>
          </>
        ) : (
          /* ── STAGE 1 ─────────────────────────────────────────────────────── */
          <>
            <h3 className="text-[17px] font-extrabold leading-snug text-gray-900">
              Cancel this bill?
            </h3>
            <p className="mt-2 text-[12.5px] leading-relaxed text-gray-500">
              <b className="font-bold text-gray-700">{row.dealerName}</b>
              <span className="text-gray-400"> · {row.obdNumber}</span>
              <span className="text-gray-400"> · {formatLitres(row.volumeLitres)} L</span>
              {lineCount !== null && (
                <span className="text-gray-400">
                  {" "}
                  · {lineCount} {lineCount === 1 ? "line" : "lines"}
                </span>
              )}
            </p>

            {/* STAGE BANNER — the whole safety design.
                pending_picking → nothing. Nobody is holding it; a banner there
                would be noise that trains the eye to skip banners. */}
            {isAssignedStage && (
              <div className="mt-3 rounded-[12px] border border-amber-200 bg-amber-50 px-3.5 py-3">
                <div className="flex gap-2">
                  <AlertTriangle size={15} className="mt-[1px] shrink-0 text-amber-600" />
                  <p className="text-[12.5px] leading-relaxed text-amber-900">
                    <b className="font-bold">
                      {row.assignedToName ?? "A picker"} is picking this bill right now.
                    </b>{" "}
                    It disappears from his phone and he gets a notification —{" "}
                    <b className="font-bold">tell him on the floor as well</b>.
                  </p>
                </div>
              </div>
            )}

            {/* REASON — tappable rows, not a native <select>: the whole row is
                the target, which is the same reason the Assign card dropped its
                checkbox (precise tapping is the floor's pain point). */}
            <div className="mt-4 text-[11px] font-bold uppercase tracking-wider text-gray-400">
              Reason
            </div>
            <div className="mt-1.5 overflow-hidden rounded-[12px] border border-gray-200">
              {CANCEL_REASON_OPTIONS.map((opt, i) => {
                const on = reason === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setReason(opt.value)}
                    disabled={busy}
                    aria-pressed={on}
                    className={
                      "flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-gray-50 disabled:opacity-50 " +
                      (i > 0 ? "border-t border-gray-100 " : "") +
                      (on ? "bg-gray-50" : "bg-white")
                    }
                  >
                    <span
                      className={
                        "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 " +
                        (on ? "border-gray-900" : "border-gray-300")
                      }
                    >
                      {on && <span className="h-[9px] w-[9px] rounded-full bg-gray-900" />}
                    </span>
                    <span
                      className={
                        "text-[14px] " + (on ? "font-bold text-gray-900" : "font-medium text-gray-700")
                      }
                    >
                      {opt.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* REMARK — optional, except where the reason cannot stand alone.
                The cap is read from the route's own constant so the counter can
                never drift from the 400 the server would return. */}
            <div className="mt-4 flex items-baseline justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                Remark{reason !== null && cancelRequiresNote(reason) ? " (required)" : " (optional)"}
              </span>
              <span
                className={
                  "text-[11px] tabular-nums " + (remaining < 0 ? "text-red-600" : "text-gray-400")
                }
              >
                {remaining}
              </span>
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, CANCEL_NOTE_MAX))}
              disabled={busy}
              rows={2}
              placeholder={
                reason !== null && cancelRequiresNote(reason)
                  ? "Say what happened — this is the only record"
                  : "Anything worth recording"
              }
              /* text-[16px] — iOS auto-zooms anything smaller on focus
                 (CLAUDE_UI.md §9's mobile input rule). */
              className="mt-1.5 w-full resize-none rounded-[12px] border border-gray-200 px-3.5 py-2.5 text-[16px] text-gray-900 placeholder:text-gray-300 focus:border-gray-400 focus:outline-none disabled:opacity-50"
            />

            <div className="mt-[18px] flex gap-2.5">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="h-12 flex-1 rounded-full border border-gray-200 bg-white text-[14.5px] font-bold text-gray-700 active:bg-gray-50 disabled:opacity-50"
              >
                Keep bill
              </button>
              <button
                type="button"
                onClick={handlePrimary}
                disabled={!canConfirm}
                className={
                  "h-12 flex-1 rounded-full text-[14.5px] font-bold " +
                  (canConfirm
                    ? "bg-red-600 text-white active:bg-red-700"
                    : "cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400")
                }
              >
                {busy ? "Cancelling…" : "Cancel bill"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
