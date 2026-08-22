"use client";

import { useCallback, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  FINDING_REASON_OPTIONS,
  MFG_MONTH_LABELS,
  findingReasonLabel,
  isFindingReason,
  mfgLabel,
  mfgYearOptions,
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

// ── The recording triangle ─────────────────────────────────────────────────
/**
 * Arms recording mode.
 *
 * ⚠ WHAT IT DOES IS UNCHANGED, AND MUST STAY UNCHANGED. It toggles one
 * screen-level boolean (`recordMode`). It performs NO write and makes no
 * network call of any kind — the POST happens on Save inside FindingPopup.
 * Arming does exactly three things: this button changes state, the banner
 * below the header appears, and the line rows become tappable. Both boards
 * gate it themselves (supervisor on `isDone`, picker on `!isDone`) and those
 * gates are theirs, not this component's.
 *
 * ⚠ IT LIVES ON THE BAND NOW, NOT IN THE HEADER (2026-08-22). It used to sit
 * in the header's right-hand icon cluster wearing the BACK BUTTON's frosted
 * tile (w-8 h-8, rounded-[9px], bg-white/15). The band it moved to is a dark
 * #0a5049 strip that already reads as a distinct surface, so the tile had
 * nothing left to separate the glyph FROM and became a box drawn for its own
 * sake. It is now bare: a 24px white glyph in a 42px tap target.
 *
 * ⚠ QUIET BY DESIGN — the 2026-08-08 rule SURVIVES this move and still binds.
 * Before that date this was a solid 38px #fbbf24 block that read as the
 * loudest thing on the screen, louder than the customer name, competing with
 * the CTA for "what do I press". Do NOT re-solidify it — no tile, no fill, no
 * slab. The banner is what announces the mode, and it does that job without
 * the header shouting. Armed is carried by the GLYPH going amber (#fbbf24,
 * the band's own amber), which is the same "colour the icon, not the box"
 * principle the frosted version used.
 *
 * Both call sites now render it through `BillBand`'s `trailing` slot.
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
      className="w-[42px] h-[42px] flex items-center justify-center shrink-0 transition-colors active:opacity-60"
      style={{ color: armed ? "#fbbf24" : "#ffffff" }}
    >
      <AlertTriangle size={24} strokeWidth={2.25} />
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

/**
 * The note under the product name. The only other colour a recorded row gets.
 *
 * ⚠ TRIMMED TO "Found <n> · <reason>" (2026-08-08, live-testing feedback) —
 * every other word that used to be here was removed on purpose. Do not put any
 * of them back:
 *   • "Recorded:" / "✓ Confirmed:" / "Picker recorded:" — the BADGE beside the
 *     row already says which state this is, in colour, and said it first. The
 *     prefix restated it in words and pushed the two facts that are NOT
 *     duplicated anywhere (the number, the reason) toward the truncation edge.
 *   • "of <ordered>" — the ordered quantity is printed in its own column on the
 *     same row, inches away. A second copy inside the note is not a reminder,
 *     it is a chance for the two to disagree while both are on screen.
 *   • "· tap to edit" / "· tap to confirm" — an instruction, not a finding. The
 *     row is tappable and looks it; a permanent label spends the row's scarcest
 *     space telling a daily user something they learned on day one.
 * `mode` is retained in the signature: it is what USED to select the tap hint,
 * and both call sites still pass it. Keep it — the two faces have diverged in
 * wording before and will again.
 *
 * Colour still carries state (amber pending / red confirmed) and the NUMBER
 * still carries the emphasis: it is the one thing a supervisor scans for.
 *
 * ── THE ONE THING ADDED BACK (2026-08-09) ──────────────────────────────────
 * "Found 9 · Old MFG · Mar 2024" — the manufacturing date, on OLD MFG lines
 * ONLY. It was held out of the note when the columns landed the day before, on
 * the reasoning that the note is a glance; the owner's call is that on an
 * old-stock line the date IS the finding, and a reader who has to open a popup
 * to learn WHICH date has not been told anything by the note at all.
 *
 * This is NOT a reversal of the three deletions above — none of them carried
 * information the row lacked, and this does. Short-quantity notes are
 * untouched: there is no date to show, and appending an empty separator there
 * would put a dangling "·" on every shortage row in the app.
 */
export function FindingNote({
  finding,
}: {
  finding: PickingLineFinding;
  /** Accepted but not bound — kept for call-site symmetry and future per-face
   *  wording (see above). Deliberately not destructured, so it is not an unused
   *  local. */
  mode: FindingMode;
}): React.JSX.Element {
  const confirmed = finding.recordedById !== null;
  // Non-null ONLY on an old_mfg row that actually carries both parts — the
  // shared formatter decides, so this note and the billing panel's cannot print
  // the date differently. A short_quantity row has both columns null by
  // construction (the write routes force them), so this is null there too and
  // no separator is emitted.
  const mfg = mfgLabel(finding.mfgMonth, finding.mfgYear);
  return (
    <div
      className="text-[12px] mt-1"
      style={{ color: confirmed ? CONFIRMED_TEXT : PENDING_TEXT }}
    >
      {/* Only the count is bold. The reason is normal weight so the eye lands
          on the number first — the reason is a category, the number is the
          fact that changes what happens next. The date stays normal weight for
          the same reason: it qualifies the reason, it is not what the row is
          scanned for. */}
      <span className="font-bold tabular-nums">Found {finding.qtyFound}</span>
      {" · "}
      {findingReasonLabel(finding.reason)}
      {mfg && <> · {mfg}</>}
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
  // Old-MFG month/year (2026-08-08). Strings, like `qty`, so an empty <select>
  // is representable — "" is the unchosen state that blocks Save.
  //
  // ⚠ NEVER PREFILLED ON A FRESH LINE, in either mode. Today's month is the one
  // value that is certainly WRONG for a stock item flagged as old, and a
  // plausible wrong default is worse than an empty field: it saves silently.
  // The whole point of collecting this is that someone read it off the tin.
  const [mfgMonth, setMfgMonth] = useState("");
  const [mfgYear, setMfgYear] = useState("");
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
        // Re-open shows what was recorded. Null on a short-quantity row, which
        // maps to "" and stays hidden behind the reason gate anyway.
        setMfgMonth(line.finding.mfgMonth !== null ? String(line.finding.mfgMonth) : "");
        setMfgYear(line.finding.mfgYear !== null ? String(line.finding.mfgYear) : "");
      } else if (mode === "report") {
        setQty(String(line.qty));
        setReason(FINDING_REASON_OPTIONS[0].value);
        setMfgMonth("");
        setMfgYear("");
      } else {
        setQty("");
        setReason("");
        setMfgMonth("");
        setMfgYear("");
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

  // Old MFG is the only reason that carries a date. `needsMfg` gates BOTH the
  // two fields' visibility and their contribution to canSave — one flag, so the
  // form can never show a field it does not require or require one it does not
  // show.
  const needsMfg = reason === "old_mfg";
  const mfgValid = !needsMfg || (mfgMonth !== "" && mfgYear !== "");
  // Both required before Save lights up, exactly as qty already is — capturing
  // the date IS the reason these columns were added, so an old_mfg row that
  // saves without one would defeat the feature silently.
  const canSave = qtyValid && reason !== "" && mfgValid;

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
          // Sent ONLY on the old_mfg branch. On short_quantity the keys are
          // omitted entirely — and the server independently forces both columns
          // to NULL on that branch regardless of what arrives, so a stale value
          // cannot survive a reason change either way (belt AND braces: this
          // client is not the only possible caller).
          ...(needsMfg ? { mfgMonth: Number(mfgMonth), mfgYear: Number(mfgYear) } : {}),
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
  }, [target, orderId, saving, canSave, mode, qtyNum, reason, needsMfg, mfgMonth, mfgYear, pickerId, onSaved, onConflict]);

  return {
    recordMode,
    setRecordMode,
    target,
    openFor,
    close,
    saving,
    popupProps: {
      mode, target, qty, setQty, reason, setReason,
      mfgMonth, setMfgMonth, mfgYear, setMfgYear, needsMfg,
      saving, qtyValid, canSave, onCancel: close, onSave: save,
    },
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
  /** "" until chosen. Rendered only when `needsMfg`. */
  mfgMonth:    string;
  setMfgMonth: (v: string) => void;
  mfgYear:     string;
  setMfgYear:  (v: string) => void;
  /** reason === 'old_mfg'. Gates the two fields' visibility AND their share of
   *  `canSave` — one flag so the form cannot show a field it does not require. */
  needsMfg:    boolean;
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
  mode, target, qty, setQty, reason, setReason,
  mfgMonth, setMfgMonth, mfgYear, setMfgYear, needsMfg,
  saving, qtyValid, canSave, onCancel, onSave,
}: FindingPopupProps): React.JSX.Element {
  const open = target !== null;
  // Recomputed per render rather than memoised: the list is six integers, and a
  // frozen one would go stale in a session left open across New Year.
  const yearOptions = mfgYearOptions();
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

        {/* ── Manufacturing date — OLD MFG ONLY (2026-08-08) ─────────────────
            Rendered only when the reason calls for it, and REQUIRED when shown
            (both feed canSave). Not rendered-and-disabled: a field that cannot
            apply should not occupy a row on a phone-sized card at all.

            ⚠ THE VALUES ARE NOT CLEARED WHEN THE REASON SWITCHES AWAY. Someone
            who picks Old MFG, types a date, then realises it is really a short
            quantity gets those keystrokes back if they switch again — the state
            is local and cheap. What makes that SAFE is the server: both routes
            force mfgMonth/mfgYear to NULL on the short_quantity branch whatever
            the body says, and this client omits the keys there too. So a
            lingering value can be seen in the form but can never be stored
            against the wrong reason.

            Month and year are SEPARATE selects, not a <input type="month">:
            that control renders as a native picker that varies per Android
            build, and the floor reads two independent things off the tin. */}
        {needsMfg && (
          <div className="grid grid-cols-2 gap-2 mb-4">
            <div>
              <label
                htmlFor="finding-mfg-month"
                className="block text-[11px] font-semibold uppercase tracking-[0.03em] text-gray-500 mb-1"
              >
                MFG month
              </label>
              {/* text-[16px] — the iOS zoom guard (CLAUDE_UI §59.1), same as
                  every other control on this card. */}
              <select
                id="finding-mfg-month"
                value={mfgMonth}
                onChange={(e) => setMfgMonth(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-[16px] text-gray-900 bg-white"
              >
                <option value="" disabled>
                  Month…
                </option>
                {/* value is the 1-12 INTEGER the column stores; the label is
                    display only. MFG_MONTH_LABELS is index-0-based, hence i+1. */}
                {MFG_MONTH_LABELS.map((label, i) => (
                  <option key={label} value={i + 1}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="finding-mfg-year"
                className="block text-[11px] font-semibold uppercase tracking-[0.03em] text-gray-500 mb-1"
              >
                MFG year
              </label>
              {/* Six years, newest first — the current year and the five before
                  it (lib/picking/findings-reasons.ts). Stock older than that is
                  rare enough that typing it is not the common case, and the
                  server accepts a wider range than this list offers, so an
                  older year entered by another caller still saves. */}
              <select
                id="finding-mfg-year"
                value={mfgYear}
                onChange={(e) => setMfgYear(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-[16px] text-gray-900 bg-white"
              >
                <option value="" disabled>
                  Year…
                </option>
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

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
