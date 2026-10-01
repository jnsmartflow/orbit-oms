"use client";

// Tint Manager — Stop & cancel (2026-10-01, tabs build step 6 — plan §D, owner
// decision 10). ONE bill an operator holds (tint_assigned, or tinting /
// paused at tinting_in_progress): the operator's job ends now, the timer stops,
// live splits are cancelled, then the bill is cancelled.
//
// POST /api/tint/manager/cancel { stop: true, orderId, reasonKey, remark? }.
// The route owns the write ORDER (assignment → splits → cancel) and the retry
// rule: after a partial failure the bill sits in the tint stage with no live
// job, and pressing Stop & cancel again finishes it. This dialog READS the
// response and shows the route's own words — including "press Stop & cancel
// again" — rather than a generic failure.
//
// Two-step confirm (CLAUDE_UI §13, as Remove OBD and Mark Done use): the first
// press turns the button into "Yes — stop and cancel"; only the second posts.
// The reason is mandatory (the route 400s without one) and comes from the DESK
// list Floor uses too (lib/floor/desk-cancel-reasons.ts, owner decision B);
// "Other" needs a remark, as the route enforces.
//
// ⚠ NO KEY LISTENER. tint-manager-content.tsx is the single Esc owner; it closes
// this through `onClose` (refused while busy, via onBusyChange).
// ⚠ A MODAL OVER THE WHOLE PAGE, the off-floor-dialog.tsx pattern (fixed,
// bg-black/40, z-[120]) — the scrim covers the bottom bar, so its brand button
// is never a second one on screen.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FLOOR_CANCEL_REASON_OPTIONS, FLOOR_REMARK_MAX } from "@/lib/floor/off-floor";
import { deskCancelRequiresNote, type DeskCancelReason } from "@/lib/floor/desk-cancel-reasons";
import { BAR_DANGER, BAR_SECONDARY } from "@/components/floor/floor-action-bar";

export interface StopCancelBill {
  orderId:      number;
  obdNumber:    string;
  siteName:     string;
  operatorName: string;
  /** "assigned" | "tinting_in_progress" | "paused" — for the warning line. */
  status:       string;
}

export function BoardStopCancelDialog({
  bill,
  onDone,
  onBusyChange,
  onClose,
}: {
  bill:         StopCancelBill;
  /** The bill was cancelled (or the job was stopped and the cancel failed —
   *  either way the board must reload). */
  onDone:       () => void;
  onBusyChange: (busy: boolean) => void;
  onClose:      () => void;
}) {
  const [reason, setReason]   = useState<DeskCancelReason | null>(null);
  const [remark, setRemark]   = useState("");
  const [armed, setArmed]     = useState(false);
  const [busy, setBusyState]  = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const setBusy = (b: boolean) => { setBusyState(b); onBusyChange(b); };
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  // Any change to the answers disarms the confirm — the second press must
  // confirm what is on screen now.
  useEffect(() => { setArmed(false); }, [reason, remark]);

  const remarkTooLong = remark.trim().length > FLOOR_REMARK_MAX;
  const needsRemark = reason !== null && deskCancelRequiresNote(reason) && remark.trim() === "";
  const canSubmit = !busy && reason !== null && !remarkTooLong && !needsRemark;

  async function press() {
    if (!canSubmit) return;
    if (!armed) { setArmed(true); return; }
    setBusy(true);
    setError(null);
    try {
      const trimmed = remark.trim();
      const res = await fetch("/api/tint/manager/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stop: true, orderId: bill.orderId, reasonKey: reason, remark: trimmed === "" ? undefined : trimmed }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        done?: number[];
        failed?: Array<{ orderId: number; error: string }>;
        stopped?: { assignmentsEnded: number; splitsCancelled: number };
      };
      if (Array.isArray(body.done) && body.done.includes(bill.orderId)) {
        toast.success(`${bill.obdNumber} stopped and cancelled`);
        onDone();
        onClose();
        return;
      }
      // Refused or partial — the route's own words ("…press Stop & cancel again").
      const msg = body.failed?.[0]?.error ?? body.error ?? `Stop & cancel failed — HTTP ${res.status}`;
      setError(msg);
      setArmed(false);
      // A stop may have landed even though the cancel did not — the board moves.
      if (body.stopped && (body.stopped.assignmentsEnded > 0 || body.stopped.splitsCancelled > 0)) onDone();
    } catch {
      setError("Could not reach the server — check your connection, then press Stop & cancel again.");
      setArmed(false);
    } finally {
      setBusy(false);
    }
  }

  const statusWord = bill.status === "paused" ? "paused" : bill.status === "assigned" ? "assigned" : "tinting";

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onClick={busy ? undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-[460px] rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5">
          <h3 className="text-[18px] font-bold text-ink-900">Stop &amp; cancel</h3>
          <p className="mt-1 text-[13px] text-ink-500">
            <span className="font-mono">{bill.obdNumber}</span> · {bill.siteName}
          </p>

          <div className="mt-4 rounded-[9px] border border-danger-bd bg-danger-bg px-3 py-2.5 text-[13px] leading-relaxed text-danger-text">
            {bill.operatorName}&apos;s job ({statusWord}) ends now and the timer stops. Any live splits are cancelled,
            then the bill is cancelled. Mixed paint stays in the room — note it in the remark.
          </div>

          <label className="mt-4 block text-[12px] font-semibold text-ink-700">
            Cancel reason <span className="text-danger-text">*</span>
          </label>
          <select
            value={reason ?? ""}
            onChange={(e) => setReason(e.target.value === "" ? null : (e.target.value as DeskCancelReason))}
            disabled={busy}
            className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[13px] focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
          >
            <option value="">Reason…</option>
            {FLOOR_CANCEL_REASON_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <label className="mt-3 block text-[12px] font-semibold text-ink-700">Remark</label>
          <textarea
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            disabled={busy}
            rows={2}
            placeholder={reason !== null && deskCancelRequiresNote(reason) ? "Remarks (required for Other)" : "Remarks (optional)"}
            className="mt-1.5 w-full resize-none rounded-lg border border-ink-200 px-3 py-2 text-[13px] focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
          />
          {remarkTooLong && (
            <p className="mt-1 text-[12px] text-danger-text">Remark is longer than {FLOOR_REMARK_MAX} characters.</p>
          )}
          {error && (
            <p className="mt-3 rounded-[9px] border border-danger-bd bg-danger-bg px-3 py-2 text-[12.5px] text-danger-text">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-ink-100 px-6 py-4">
          <button type="button" onClick={onClose} disabled={busy} className={BAR_SECONDARY}>
            Back
          </button>
          {/* Destructive — danger, never brand (CLAUDE_UI §2/§10). */}
          <button type="button" onClick={() => { void press(); }} disabled={!canSubmit} className={BAR_DANGER}>
            {busy ? "Stopping…" : armed ? "Yes — stop and cancel" : "Stop & cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
