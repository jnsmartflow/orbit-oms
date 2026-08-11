"use client";

// Floor Control — the "Assigning to {name}" band (2026-08-11).
//
// Shown while the operator has drilled into ONE picker from the By-picker grid.
// It is a MODE indicator, not a remark display: it says what the board below is
// currently scoped to, offers the one alternate reading of that scope, and
// carries the way out.
//
// ⚠ WHY THIS IS NOT components/mail-orders/instructions-strip.tsx. That was the
// obvious candidate (it already has a `tone` prop and a `controlsSlot`), and it
// was evaluated and rejected on three counts:
//   1. Its caption is DERIVED FROM THE PROP NAME (`{row.kind}` — "delivery" /
//      "bill" / "notes") and there is no way to suppress or rename it. Passing
//      this text as `notes` renders "NOTES · Assigning to Harish Padvi".
//   2. It belongs to Mail Orders — its consumers are review-view.tsx and the
//      flag-gated Billing v2 face. Teaching it a fourth kind would mean editing
//      a live billing surface to serve Floor, the coupling direction FLOOR §1
//      exists to prevent.
//   3. Different job and lifetime: it is a passive read-out that returns null
//      when empty; this is an interactive control that must always be visible
//      while the mode is on.
//
// What IS reused is the SHADE, not the component: the violet tokens below are
// Floor's own, read from components/floor/tint-strip.tsx (:30 bg/text, :43
// accent) — the same pair instructions-strip.tsx's own violet tone copied from.
// One owner for the colour, so the screens still cannot drift.

export function AssignContextBanner({
  pickerName,
  contextMode,
  pendingCount,
  currentCount,
  onToggleMode,
  onCancel,
}: {
  pickerName: string;
  contextMode: "pending" | "current";
  /** Bills currently listed as assignable (status waiting). */
  pendingCount: number;
  /** Bills already in this picker's hands (withPicker + needsCheck). */
  currentCount: number;
  onToggleMode: () => void;
  onCancel: () => void;
}) {
  const onPending = contextMode === "pending";

  return (
    <div className="flex items-center gap-2.5 border-b border-t-gray-100 border-l-[3px] border-b-gray-200 border-l-[#7c3aed] bg-[#f5f3ff] px-3.5 py-2 text-[11.5px] text-[#5b21b6]">
      <span className="font-semibold">Assigning to {pickerName}</span>

      <span className="text-[10.5px] opacity-80">
        {onPending
          ? `${pendingCount} bill${pendingCount === 1 ? "" : "s"} to hand over`
          : `${currentCount} already in his hands · read only`}
      </span>

      {/* The one alternate reading of this scope. Deliberately a quiet link and
          not a segmented control: there are exactly two states and the band is
          already carrying the primary message. */}
      <button
        type="button"
        onClick={onToggleMode}
        className="rounded-[4px] px-1.5 py-px text-[10.5px] font-semibold underline decoration-[#7c3aed]/40 underline-offset-2 hover:bg-white/60 hover:decoration-[#7c3aed]"
      >
        {onPending ? `Show what he's holding (${currentCount})` : `Show bills to assign (${pendingCount})`}
      </button>

      <button
        type="button"
        onClick={onCancel}
        aria-label="Stop assigning to this picker"
        title="Stop assigning to this picker"
        className="ml-auto flex h-5 items-center gap-1 rounded-[4px] px-1.5 text-[10.5px] font-semibold text-[#5b21b6] hover:bg-white/60"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
        Done
      </button>
    </div>
  );
}
