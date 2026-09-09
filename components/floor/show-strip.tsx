"use client";

// Floor Control — the "Show them" strip (2026-09-09).
//
// Rises above the assign bar when the operator has selected bills that are still
// at his desk. Shape follows components/floor/assign-context-banner.tsx: a
// left-accented band with a message, one action, and no chrome of its own.
//
// ⚠ NOT A FIFTH ASSIGN-BAR CONTROL, and it must never become one. The bar is
// held to four controls by a recorded design decision that cost three bulk
// actions to reach (assign-bar.tsx:11-15). This is also a genuinely different
// job: the bar hands bills to a PICKER, this hands them to the FLOOR. They are
// two steps of one flow, which is why the strip sits directly above the bar
// rather than beside its buttons.
//
// AMBER to match the header switch, because it is the same subject — the gate —
// and a second colour would make the two read as unrelated features. Not teal:
// reserved for the primary action (CLAUDE_UI §1), which on this screen is Assign.

export function ShowStrip({
  count,
  busy,
  onShow,
}: {
  /** How many SELECTED bills are still at the desk. Never the whole selection. */
  count: number;
  busy: boolean;
  onShow: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-t border-b-[#fcd34d] border-t-gray-100 border-l-[3px] border-l-[#b45309] bg-[#fffbeb] px-3.5 py-2 text-[11.5px] text-[#92400e]">
      <span className="font-semibold">
        {count} bill{count === 1 ? "" : "s"} not yet shown
      </span>
      <span className="text-[10.5px] opacity-80">
        the floor cannot see {count === 1 ? "it" : "them"} yet
      </span>

      <button
        type="button"
        onClick={onShow}
        disabled={busy}
        className="ml-auto inline-flex h-[26px] items-center rounded-[5px] bg-[#b45309] px-3 text-[11px] font-semibold text-white hover:bg-[#92400e] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Showing…" : `Show ${count === 1 ? "it" : "them"}`}
      </button>
    </div>
  );
}
