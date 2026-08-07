"use client";

import { useCallback, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  FINDING_REASON_OPTIONS,
  findingReasonLabel,
  isFindingReason,
  type FindingReason,
} from "@/lib/picking/findings-reasons";
import { NO_BILL_SWIPE_ATTR } from "./use-bill-pager";
import type { PickingDetailLine, PickingLineFinding } from "@/lib/picking/types";

// ── Shortfall recording — ONE implementation, both picking faces ───────────
// Extracted 2026-08-08 from picker-my-picks-board.tsx (shipped 4d9d4535) when
// the supervisor's Done-tab detail gained the same triangle-and-popup screen.
// Same seam card-atoms.tsx and use-bill-pager.ts already occupy: the picking
// module's shared machinery lives under components/picking/, not
// components/shared/, because it is typed on picking's own row shapes.
//
// The mockup is explicit that both roles use the EXACT same screen
// (docs/mockups/picking/picking-shortfall-design.html — "picker and supervisor
// now use the exact same triangle-and-popup screen"), so a single source is the
// whole point. What differs between the two callers is exactly THREE things,
// all carried by `mode`:
//   • which route the save posts to (report vs confirm)
//   • the Save button's label ("Save" vs "Confirm")
//   • the prefill policy for a fresh line (see openFor below)
// Nothing else. If a fourth difference appears, add it to `mode` here rather
// than forking the component.
//
// ⚠ WHAT THIS FILE MUST NEVER LEARN: whether a line is ticked, whether Mark
// done / Approve is enabled, or anything about either board's list state. The
// tick and the CTA gate stay with the callers — same discipline that keeps
// use-bill-pager.ts shareable.

export type FindingMode = "report" | "confirm";

/** none → nothing recorded · pending → picker reported · confirmed → supervisor signed off. */
export type FindingState = "none" | "pending" | "confirmed";

/** THE one place the amber/red decision is made. Both boards call this rather
 *  than re-testing recordedById at each render site. */
export function findingState(finding: PickingLineFinding | null | undefined): FindingState {
  if (!finding) return "none";
  return finding.recordedById !== null ? "confirmed" : "pending";
}

// Status colours. Amber = reported, awaiting a supervisor. Red = confirmed.
// Deliberately NOT teal — teal belongs to the primary CTA on both screens
// (CLAUDE_UI §1's one-teal rule).
const PENDING_COLOR   = "#f59e0b";
const CONFIRMED_COLOR = "#dc2626";
const PENDING_TEXT    = "#92400e";
const CONFIRMED_TEXT  = "#b91c1c";

// ── The header triangle ────────────────────────────────────────────────────
/**
 * Arms recording mode.
 *
 * ⚠ QUIET BY DESIGN (2026-08-08, from live-testing feedback). This was a solid
 * 38px #fbbf24 block, which read as the loudest thing on the header — louder
 * than the customer name, and competing with the CTA for "what do I press".
 * It now matches the BACK BUTTON's frosted treatment exactly (w-8 h-8,
 * rounded-[9px], bg-white/15), carrying its meaning through an amber ICON
 * rather than an amber slab. Armed state is a soft amber wash plus a ring, not
 * a fill. Do not re-solidify it: the banner below is what announces the mode,
 * and it does that job without shouting from the header.
 */
export function FindingTriangleButton({
  armed,
  onToggle,
}: {
  armed: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={armed ? "Stop recording shortages" : "Record a shortage"}
      aria-pressed={armed}
      className={
        "w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0 transition-colors " +
        (armed
          ? "bg-[#fbbf24]/30 ring-1 ring-[#fcd34d] text-[#fde68a]"
          : "bg-white/15 text-white/80 active:bg-white/25")
      }
    >
      <AlertTriangle size={16} strokeWidth={2.25} />
    </button>
  );
}

// ── The recording banner ───────────────────────────────────────────────────
/** The mockup's `.record-banner`. Render it OUTSIDE the bill-pager's sliding
 *  wrapper on both boards — recording is a screen-level mode, so it must not
 *  slide away and back on every swipe between bills. */
export function FindingRecordBanner({ onDone }: { onDone: () => void }): React.JSX.Element {
  return (
    <div className="shrink-0 flex items-center justify-between gap-3 bg-[#fffbeb] border-b border-[#fde68a] px-4 py-2.5">
      <span className="text-[12px] font-semibold text-[#92400e]">
        Recording mode — tap any line to record what you found
      </span>
      <button
        type="button"
        onClick={onDone}
        className="text-[12px] font-semibold text-[#78350f] underline shrink-0"
      >
        Done
      </button>
    </div>
  );
}

// ── Row bits ───────────────────────────────────────────────────────────────
/**
 * The status circle that replaces a line's tick once something is recorded.
 *
 * ⚠ ROW TINTING WAS REMOVED (2026-08-08, live-testing feedback). Rows used to
 * take a full amber/red background plus a 2px border, which made a bill with a
 * few findings look alarming end to end and buried the ordinary rows. The row
 * now stays white like every other row, and the status is carried by exactly
 * two quiet things: THIS badge, and the coloured note line below the product
 * name. Do not re-add a row fill.
 */
export function FindingStatusBadge({
  state,
  onOpen,
}: {
  state: Exclude<FindingState, "none">;
  onOpen: () => void;
}): React.JSX.Element {
  const confirmed = state === "confirmed";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      aria-label={confirmed ? "Confirmed shortage — review" : "Recorded shortage — confirm or edit"}
      className="w-11 shrink-0 flex items-center justify-center"
    >
      <span
        className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[11px] font-bold leading-none"
        style={{ background: confirmed ? CONFIRMED_COLOR : PENDING_COLOR }}
      >
        {confirmed ? "⚠" : "!"}
      </span>
    </button>
  );
}

/** The note under the product name — carries BOTH numbers so the row reads
 *  without opening anything. The only other colour a recorded row gets. */
export function FindingNote({
  finding,
  qtyOrdered,
  mode,
}: {
  finding: PickingLineFinding;
  qtyOrdered: number;
  mode: FindingMode;
}): React.JSX.Element {
  const confirmed = finding.recordedById !== null;
  // The supervisor is the one who acts on a pending line, so only his copy
  // invites a tap. The picker's own pending line just states what he recorded.
  const tail = confirmed ? "" : mode === "confirm" ? " · tap to confirm" : " · tap to edit";
  return (
    <div
      className="text-[12px] font-semibold mt-1"
      style={{ color: confirmed ? CONFIRMED_TEXT : PENDING_TEXT }}
    >
      {confirmed ? "✓ Confirmed: " : "Recorded: "}
      found {finding.qtyFound} of {qtyOrdered} · {findingReasonLabel(finding.reason)}
      {tail}
    </div>
  );
}

// ── The hook ───────────────────────────────────────────────────────────────
interface UseFindingRecorderOptions {
  mode: FindingMode;
  /** The bill currently open. Null closes/blocks saving. */
  orderId: number | null;
  /** report mode only — the admin view-as passthrough. Ignored by the server
   *  for a real picker, whose session id always wins. */
  pickerId?: number | null;
  /** Merge the saved row into the caller's own lineItems. */
  onSaved: (rawLineItemId: number, finding: PickingLineFinding) => void;
  /** A 409 — the server knows something the screen does not. The caller
   *  should force a re-read of the bill. */
  onConflict: () => void;
}

export interface FindingRecorder {
  recordMode:    boolean;
  setRecordMode: (on: boolean) => void;
  /** The line whose popup is open, or null. */
  target:        PickingDetailLine | null;
  openFor:       (line: PickingDetailLine) => void;
  close:         () => void;
  saving:        boolean;
  /** Spread onto <FindingPopup>. */
  popupProps:    FindingPopupProps;
}

export function useFindingRecorder({
  mode, orderId, pickerId, onSaved, onConflict,
}: UseFindingRecorderOptions): FindingRecorder {
  const [recordMode, setRecordMode] = useState(false);
  const [target, setTarget] = useState<PickingDetailLine | null>(null);
  // Strings while editing — a number state fights the input the moment the
  // user clears the field to retype.
  const [qty, setQty] = useState("");
  // "" = nothing chosen yet. Only reachable in confirm mode on a fresh line,
  // where the mockup shows no preselected reason.
  const [reason, setReason] = useState<FindingReason | "">("");
  const [saving, setSaving] = useState(false);

  /**
   * PREFILL POLICY — the one place it lives.
   *   existing finding    → its own numbers, whoever recorded them
   *   report, fresh line   → qty ORDERED + the first reason. The common edit is
   *                          "one less than ordered", so starting full is one
   *                          keystroke rather than a re-type (the mockup's
   *                          `openModal(el.dataset.qty)`).
   *   confirm, fresh line  → EMPTY, nothing preselected. A supervisor recording
   *                          from scratch has not counted anything yet, and a
   *                          prefilled number he did not type is a number he
   *                          might save by accident.
   */
  const openFor = useCallback(
    (line: PickingDetailLine) => {
      setTarget(line);
      if (line.finding) {
        setQty(String(line.finding.qtyFound));
        setReason(isFindingReason(line.finding.reason) ? line.finding.reason : "");
      } else if (mode === "report") {
        setQty(String(line.qty));
        setReason(FINDING_REASON_OPTIONS[0].value);
      } else {
        setQty("");
        setReason("");
      }
    },
    [mode],
  );

  const close = useCallback(() => setTarget(null), []);

  const qtyNum = Number(qty);
  const qtyValid =
    target !== null &&
    qty.trim() !== "" &&
    Number.isInteger(qtyNum) &&
    qtyNum >= 0 &&
    qtyNum <= target.qty;
  const canSave = qtyValid && reason !== "";

  const save = useCallback(async () => {
    if (target === null || orderId === null || saving || !canSave) return;
    const line = target;
    setSaving(true);
    try {
      const url =
        mode === "report" ? "/api/picking/findings/report" : "/api/picking/findings/confirm";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          rawLineItemId: line.id,
          qtyFound: qtyNum,
          reason,
          // ⚠ `remarks` is DELIBERATELY NOT SENT (2026-08-08). The field was
          // removed from this popup, and both routes treat an ABSENT remarks
          // key as "leave whatever is there" — sending null would silently wipe
          // a remark typed before the field went away, or one added by another
          // surface later. The column and the API parameter both stay.
          ...(mode === "report" && pickerId != null ? { pickerId } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        finding?: PickingLineFinding;
        error?: string;
      };
      if (!res.ok) {
        if (res.status === 409) {
          toast("Already changed — refreshed.");
          setTarget(null);
          onConflict();
        } else {
          toast.error(json.error ?? `Request failed (${res.status})`);
        }
        return;
      }
      if (json.finding) onSaved(line.id, json.finding);
      toast.success(`${line.sku} — found ${qtyNum} of ${line.qty}`);
      setTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }, [target, orderId, saving, canSave, mode, qtyNum, reason, pickerId, onSaved, onConflict]);

  return {
    recordMode,
    setRecordMode,
    target,
    openFor,
    close,
    saving,
    popupProps: { mode, target, qty, setQty, reason, setReason, saving, qtyValid, canSave, onCancel: close, onSave: save },
  };
}

// ── The popup ──────────────────────────────────────────────────────────────
export interface FindingPopupProps {
  mode:      FindingMode;
  target:    PickingDetailLine | null;
  qty:       string;
  setQty:    (v: string) => void;
  reason:    FindingReason | "";
  setReason: (v: FindingReason | "") => void;
  saving:    boolean;
  qtyValid:  boolean;
  canSave:   boolean;
  onCancel:  () => void;
  onSave:    () => void;
}

/**
 * The record popup.
 *
 * ⚠ ALWAYS MOUNTED, opacity/scale-toggled — NOT conditionally rendered
 * (2026-08-08, live-testing feedback: "rough to open"). A conditionally
 * rendered overlay has no previous frame to transition FROM, so it appeared
 * instantly at full opacity with the card at final size — a hard pop, plus a
 * visible reflow as the backdrop painted. This is the same always-mounted
 * pattern mobile-shell-context.tsx uses for its own sheets and sign-out
 * confirm, and it is why they feel smooth. Do not "simplify" it back to
 * `{open && <div/>}`.
 *
 * Because it stays mounted, the last target is retained for the fade-OUT — the
 * card must not blank to "—" while it is still visible on screen.
 *
 * ⚠ REMARKS WAS REMOVED (2026-08-08). Qty found + reason only. The column and
 * the API parameter both remain; this UI simply no longer collects it.
 */
export function FindingPopup({
  mode, target, qty, setQty, reason, setReason, saving, qtyValid, canSave, onCancel, onSave,
}: FindingPopupProps): React.JSX.Element {
  const open = target !== null;
  // Retained so the fade-out renders the bill it was actually about.
  const lastRef = useRef<PickingDetailLine | null>(null);
  if (target !== null) lastRef.current = target;
  const shown = target ?? lastRef.current;

  return (
    <div
      // ⚠ THE BILL-PAGER OPT-OUT LIVES HERE, not at the call sites. BOTH boards
      // render this popup inside the element carrying pager.touchHandlers, so
      // without it a horizontal drag across the card is claimed by the pager
      // and pages to the next bill mid-edit — the pack-filter bug of
      // 2026-07-30 (CLAUDE_PICKING.md §5.3). Owning it here means a future
      // third caller cannot forget it.
      {...{ [NO_BILL_SWIPE_ATTR]: "" }}
      // z-[65] matches picking-board-mobile.tsx's SHEET_GEOMETRY.scrimZ, chosen
      // to clear mobile-shell's OWN stack (nav z-40, scrim z-50, sheets z-[60]).
      className={
        "fixed inset-0 z-[65] bg-black/45 flex items-center justify-center px-6 transition-opacity duration-200 " +
        (open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none")
      }
      onClick={() => {
        if (!saving) onCancel();
      }}
      aria-hidden={!open}
    >
      <div
        className={
          "w-full max-w-[320px] rounded-2xl bg-white p-5 transition-transform duration-200 ease-out " +
          (open ? "scale-100" : "scale-95")
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[12px] text-gray-400">{shown?.pack ?? "—"}</div>
        <div className="font-mono text-[15px] font-bold text-gray-900 mt-0.5">{shown?.sku ?? "—"}</div>
        <div className="text-[12px] text-gray-400 mb-4 truncate">{shown?.name ?? "—"}</div>

        <span className="block text-[11px] font-semibold uppercase tracking-[0.03em] text-gray-500 mb-1">
          Qty ordered
        </span>
        <div className="text-[14px] font-semibold text-gray-700 mb-3 tabular-nums">
          {shown?.qty ?? "—"}
        </div>

        <label
          htmlFor="finding-qty"
          className="block text-[11px] font-semibold uppercase tracking-[0.03em] text-gray-500 mb-1"
        >
          Qty found
        </label>
        {/* text-[16px] — the iOS zoom guard every mobile input in this app uses
            (CLAUDE_UI §59.1). 14px would zoom the whole screen on focus. */}
        <input
          id="finding-qty"
          type="number"
          inputMode="numeric"
          min={0}
          max={shown?.qty}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-[16px] text-gray-900 tabular-nums"
        />
        {/* Fixed-height slot so showing the hint never shifts the buttons
            downward under a thumb already travelling toward Save. */}
        <div className="h-[18px] flex items-center">
          {!qtyValid && qty.trim() !== "" && (
            <span className="text-[11px] font-medium text-red-600">
              Enter a whole number from 0 to {shown?.qty ?? 0}
            </span>
          )}
        </div>

        <label
          htmlFor="finding-reason"
          className="block text-[11px] font-semibold uppercase tracking-[0.03em] text-gray-500 mb-1 mt-1"
        >
          Reason
        </label>
        {/* Options come from lib/picking/findings-reasons.ts — the SAME list the
            server validates against, so this control can never offer a value
            the API would 400. */}
        <select
          id="finding-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value as FindingReason | "")}
          className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-[16px] text-gray-900 mb-4 bg-white"
        >
          <option value="" disabled>
            Select a reason…
          </option>
          {FINDING_REASON_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex-1 h-11 rounded-[10px] border border-gray-300 bg-white text-[13px] font-semibold text-gray-600 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !canSave}
            className="flex-1 h-11 rounded-[10px] bg-teal-600 active:bg-teal-700 text-[13px] font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Saving…" : mode === "confirm" ? "Confirm" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
