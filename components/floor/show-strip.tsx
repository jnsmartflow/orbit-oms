"use client";

// Floor Control — the desk-handover strip (2026-09-09).
//
// Rises above the assign bar when the operator's selection contains bills he can
// hand to the floor, pull back from it, or both. Shape follows
// components/floor/assign-context-banner.tsx: a left-accented band with a
// message, its actions, and no chrome of its own.
//
// ⚠ NOT A FIFTH ASSIGN-BAR CONTROL, and it must never become one. The bar is
// held to four controls by a recorded design decision that cost three bulk
// actions to reach (assign-bar.tsx:11-15). This is also a genuinely different
// job: the bar hands bills to a PICKER, this hands them to the FLOOR. They are
// two steps of one flow, which is why the strip sits directly above the bar
// rather than beside its buttons.
//
// ⚠ TWO INDEPENDENT GROUPS, AND A MIXED SELECTION OFFERS BOTH. The operator
// works in bulk and ticks by eye, so a selection routinely spans both states.
// Hiding one action because the other applies would make him deselect, act,
// reselect — and each button sends ONLY its own ids, never the selection.
//
// AMBER to match the header switch, because it is the same subject — the gate —
// and a second colour would make the two read as unrelated features.
//
// ⚠ NO CONFIRM ON EITHER ACTION. Both are reversible by the other button in one
// tap, and the row's own pill shows the result immediately. A dialog on a bulk
// action the operator repeats all day is a tax, not a safety net — and the real
// safety net is server-side (a bill a picker already holds is refused).

export function ShowStrip({
  notShownCount,
  shownCount,
  busy,
  onShow,
  onSendBack,
}: {
  /** SELECTED bills that are waiting and still at the desk. May be 0. */
  notShownCount: number;
  /** SELECTED bills that are waiting and already handed over. May be 0. */
  shownCount: number;
  busy: boolean;
  onShow: () => void;
  onSendBack: () => void;
}) {
  // The caller already guarantees at least one is non-zero, but a strip with
  // nothing to offer would be a bare amber bar — guard rather than trust.
  if (notShownCount === 0 && shownCount === 0) return null;

  const parts: string[] = [];
  if (notShownCount > 0) parts.push(`${notShownCount} not yet shown`);
  if (shownCount > 0) parts.push(`${shownCount} already shown`);

  return (
    <div className="flex items-center gap-2.5 border-b border-t border-b-[#fcd34d] border-t-gray-100 border-l-[3px] border-l-[#b45309] bg-[#fffbeb] px-3.5 py-2 text-[11.5px] text-[#92400e]">
      <span className="font-semibold">{parts.join(" · ")}</span>
      {notShownCount > 0 && (
        <span className="text-[10.5px] opacity-80">
          the floor cannot see {notShownCount === 1 ? "it" : "them"} yet
        </span>
      )}

      <span className="ml-auto flex items-center gap-2">
        {/* REVERSE — a plain bordered button, deliberately quieter. Teal stays on
            the forward action (CLAUDE_UI §1's one-teal rule), and pulling work
            back should never look like the thing to do next. */}
        {shownCount > 0 && (
          <button
            type="button"
            onClick={onSendBack}
            disabled={busy}
            className="inline-flex h-[26px] items-center rounded-[5px] border border-[#d6a84f] bg-white px-3 text-[11px] font-semibold text-[#92400e] hover:bg-[#fef3c7] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Send {shownCount === 1 ? "it" : `${shownCount}`} back to desk
          </button>
        )}
        {notShownCount > 0 && (
          <button
            type="button"
            onClick={onShow}
            disabled={busy}
            className="inline-flex h-[26px] items-center rounded-[5px] bg-[#b45309] px-3 text-[11px] font-semibold text-white hover:bg-[#92400e] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Working…" : `Show ${notShownCount === 1 ? "it" : "them"}`}
          </button>
        )}
      </span>
    </div>
  );
}
