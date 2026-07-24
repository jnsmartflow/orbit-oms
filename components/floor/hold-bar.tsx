"use client";

// Floor Control — the Hold tab's bulk release bar (design §8, mockup
// 01-board.html `holdBar()`). Rises when 1+ held bills are ticked.
//
// "No per-row release button and no per-row slot picker. He releases in bulk —
// tick rows, the bottom bar rises with `release to [date ▾] [window ▾]`, then
// Release. Same shape as Support." (design §8)
//
// The date+window control is components/support/dispatch-slot-picker.tsx REUSED
// AS-IS — its one popover already carries both halves the mockup draws as two
// selects, so there is nothing to fork. Release is disabled until a slot is
// chosen; a held bill must never go to the floor without a dispatch promise.

import { useState } from "react";
import { DispatchSlotPicker, type DispatchWindow, type DispatchSlotValue } from "@/components/support/dispatch-slot-picker";

export function HoldBar({
  count,
  windows,
  busy,
  onRelease,
  onClear,
}: {
  count: number;
  windows: DispatchWindow[];
  busy: boolean;
  onRelease: (date: string, windowId: number) => void;
  onClear: () => void;
}) {
  const [slot, setSlot] = useState<DispatchSlotValue | null>(null);

  const ghostBtn =
    "h-[30px] rounded-[6px] border border-gray-200 bg-white px-[13px] text-[11.5px] text-gray-500 hover:border-gray-300 hover:text-gray-700 disabled:opacity-40";

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t border-gray-200 bg-white px-4 py-[11px] text-[12px] shadow-[0_-4px_16px_rgba(0,0,0,0.05)]">
      <span className="font-semibold text-gray-900">{count} selected</span>

      <div className="ml-auto flex items-center gap-2">
        <span className="text-[11.5px] text-gray-500">release to</span>
        <DispatchSlotPicker value={slot} onChange={setSlot} windows={windows} popoverDir="up" popoverAlign="right" />

        <span className="mx-1 h-5 w-px bg-gray-200" />

        <button type="button" className={ghostBtn} onClick={onClear} disabled={busy}>
          Clear
        </button>
        <button
          type="button"
          disabled={!slot || busy}
          onClick={() => slot && onRelease(slot.date, slot.dispatchWindowId)}
          className="h-[30px] rounded-[6px] bg-teal-600 px-[13px] text-[11.5px] font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Releasing…" : "Release"}
        </button>
      </div>
    </div>
  );
}
