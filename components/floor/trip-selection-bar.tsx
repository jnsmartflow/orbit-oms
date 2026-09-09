"use client";

// Floor Control — the bar shown when the selection sits INSIDE a trip band.
//
// 🔴 IT REPLACES THE ASSIGN BAR, IT DOES NOT SIT BESIDE IT. Ticking bills in a
// trip band was showing Change slot / Choose picker / Assign, which are three
// answers to questions nobody asked of a trip: the slot belongs to the trip now,
// and assigning a picker is the supervisor's job on /picking. What the operator
// wants there is one thing — take these off the load.
//
// ⚠ SELECTING IN THE POOL KEEPS THE ASSIGN BAR UNCHANGED. The pool is ordinary
// waiting work; only a selection whose bills are already ON a trip gets this.
// floor-page decides which bar to render, from the rows themselves.
//
// Shape follows show-strip.tsx and assign-context-banner.tsx: a bar with a
// summary, its one action, and the same ✕ global clear the assign bar carries —
// `toggleAll()` is per-group and selects-all on a partial selection
// (lib/floor/selection.ts), so a cross-band selection can only be cleared here.
//
// ⚠ NO CONFIRM. Removing a bill from a trip is reversible in one press (it
// returns to the At-desk pool, and Add to trip puts it back), the bill's own
// workflowStage is untouched, and a dialog on an action the operator repeats
// while building a load is a tax rather than a safety net.

export function TripSelectionBar({
  count,
  litres,
  tripLabel,
  busy,
  onRemove,
  onClear,
}: {
  /** Selected bills that are on a trip. */
  count: number;
  /** Their litres, already formatted by the caller through formatLitres. */
  litres: string;
  /**
   * The trip they are on, when the selection is all on ONE trip — null when it
   * spans several. Named rather than counted because "Remove 4 from L-260910-02"
   * is a sentence the operator can check before pressing.
   */
  tripLabel: string | null;
  busy: boolean;
  onRemove: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 flex h-[60px] items-center border-t border-gray-200 bg-white px-[18px] shadow-[0_-6px_18px_-12px_rgba(0,0,0,0.25)]">
      <div className="flex min-w-0 items-center gap-[7px]">
        <span className="whitespace-nowrap text-[13px] font-semibold text-gray-900">
          {count} selected
        </span>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          title="Clear selection"
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <span className="truncate whitespace-nowrap text-[11px] text-gray-400">
          &middot; {litres} L{tripLabel ? ` · on ${tripLabel}` : " · across several trips"}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-[14px]">
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="inline-flex h-[34px] items-center rounded-md border border-[#d6a3a3] bg-white px-4 text-[12px] font-semibold text-[#b91c1c] hover:bg-[#fef2f2] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Working…" : `Remove from trip${tripLabel ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
