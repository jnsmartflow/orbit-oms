"use client";

// Floor Control — the sticky assignment bar (design §7.8, mockup
// docs/mockups/floor-control/bulk-bar-v2.html). Rises when 1+ rows are selected.
// He works in BULK: there is no per-row release button and no per-row slot picker
// on the floor.
//
// FOUR controls only (v2 rebuild): a selection summary, ONE "Change slot" button
// (opens the reused DispatchSlotPicker), the joined [picker ▾ + Assign] unit, and
// Clear. Deliberately retired vs the old 8-control bar (CLAUDE_FLOOR §8):
//   - Mark urgent → now the per-row ⚡ in the floor table.
//   - Hold        → now the detail panel's ⋯ menu (single-bill decision).
//   - Bulk Unassign-to-waiting → gone (the bar keeps reassign-to-picker; the panel
//                                keeps per-bill Unassign).
//
// Assign/Reassign resolve to "put every selected bill under this picker" — the page
// unassigns any already-assigned ones first, then assigns the batch, through the
// EXISTING Picking endpoints, unchanged. Change slot posts /api/floor/actions.
// TEAL: Assign is the ONLY teal element here (CLAUDE_UI §1).

import { useState } from "react";
import { DispatchSlotPicker, type DispatchWindow } from "@/components/floor/dispatch-slot-picker";
import { sumLitres } from "./status-pill";
import type { FloorBoardRow, FloorPicker } from "@/lib/floor/types";

export function AssignBar({
  selectedRows,
  pickers,
  lockedPicker = null,
  windows,
  onAssign,
  onChangeSlot,
  onClear,
}: {
  selectedRows: FloorBoardRow[];
  pickers: FloorPicker[];
  /**
   * When the operator arrived from a picker card (the By-picker assign context),
   * the target is ALREADY chosen — the bar shows who it is and drops the
   * dropdown rather than re-asking. null/omitted = the ordinary bar, byte for
   * byte: the `pickers` select below is what renders and nothing else moves.
   */
  lockedPicker?: { id: number; name: string } | null;
  windows: DispatchWindow[];
  onAssign: (pickerId: number) => void;
  onChangeSlot: (date: string, windowId: number) => void;
  onClear: () => void;
}) {
  const [pickerId, setPickerId] = useState<number | "">("");
  // Gen counter that opens the reused DispatchSlotPicker programmatically, so ONE
  // spec-styled "Change slot" button is the whole slot control. Starts at 0 →
  // passed as undefined so the picker never auto-opens on mount; first click → 1.
  const [slotGen, setSlotGen] = useState(0);

  const count = selectedRows.length;

  if (count === 0) return null;

  const litres = sumLitres(selectedRows);
  const assignedCount = selectedRows.filter((r) => r.isAssigned).length;
  const allAssigned = assignedCount === count;
  const routes = new Set(selectedRows.map((r) => r.route).filter(Boolean)).size;

  // Summary (mockup states 1/3/4): 1 row → "{customer} · {vol} L"; 2+ → "{total} L
  // · {n} routes"; append " · {n} already assigned" when any selected row is with a
  // picker already. All derived from selectedRows — no new fetch.
  let summary =
    count === 1
      ? `${selectedRows[0].dealerName} · ${litres.toLocaleString("en-US")} L`
      : `${litres.toLocaleString("en-US")} L · ${routes} route${routes === 1 ? "" : "s"}`;
  if (assignedCount > 0) summary += ` · ${assignedCount} already assigned`;

  const assignLabel = allAssigned ? `Reassign all ${count}` : "Assign";

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 flex h-[60px] items-center border-t border-gray-200 bg-white px-[18px] shadow-[0_-6px_18px_-12px_rgba(0,0,0,0.25)]">
      {/* LEFT — selection summary + inline Clear (✕) */}
      <div className="flex min-w-0 items-center gap-[7px]">
        <span className="whitespace-nowrap text-[13px] font-semibold text-gray-900">{count} selected</span>
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
        <span className="truncate whitespace-nowrap text-[11px] text-gray-400">&middot; {summary}</span>
      </div>

      {/* RIGHT — action group */}
      <div className="ml-auto flex items-center gap-[14px]">
        {/* Change slot — ONE button; opens the reused DispatchSlotPicker upward.
            The picker's own trigger is overlaid invisibly and stretched to this
            button's box purely to anchor its (body-portalled) popover. The shared
            component is NOT modified. */}
        <div className="relative inline-flex h-[34px]">
          <button
            type="button"
            onClick={() => setSlotGen((g) => g + 1)}
            className="inline-flex h-[34px] items-center gap-2 rounded-md border border-gray-300 bg-white px-[13px] text-[12px] font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-gray-500">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M8 3v4M16 3v4M3 10h18" />
            </svg>
            Change slot
          </button>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-0 [&>div]:!block [&>div]:h-full [&>div]:w-full [&>div>button]:!h-full [&>div>button]:!w-full"
          >
            <DispatchSlotPicker
              value={null}
              onChange={(v) => v && onChangeSlot(v.date, v.dispatchWindowId)}
              windows={windows}
              popoverDir="up"
              popoverAlign="right"
              forceOpenGen={slotGen || undefined}
            />
          </div>
        </div>

        {/* Divider */}
        <span className="h-[22px] w-px bg-gray-200" />

        {/* Assign unit — dropdown + button touch and read as one control.
            With a lockedPicker the dropdown becomes a static target label: same
            box, same joined geometry, one less decision. */}
        <div className="flex h-[34px] items-stretch">
          {lockedPicker ? (
            <span className="flex h-[34px] min-w-[168px] items-center rounded-l-md border border-r-0 border-gray-300 bg-gray-50 px-3 text-[12px] text-gray-700">
              To&nbsp;<span className="font-semibold text-gray-900">{lockedPicker.name}</span>
            </span>
          ) : (
            <select
              value={pickerId}
              onChange={(e) => setPickerId(e.target.value === "" ? "" : Number(e.target.value))}
              className="h-[34px] min-w-[168px] cursor-pointer rounded-l-md border border-r-0 border-gray-300 bg-white pl-3 pr-7 text-[12px] text-gray-700"
            >
              <option value="">Choose picker</option>
              {pickers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.onHand === 0 ? " - free" : ` - ${p.onHand} on hand`}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            disabled={!lockedPicker && pickerId === ""}
            onClick={() => {
              if (lockedPicker) onAssign(lockedPicker.id);
              else if (pickerId !== "") onAssign(pickerId);
            }}
            className="h-[34px] rounded-r-md border border-teal-600 bg-teal-600 px-5 text-[12px] font-semibold text-white enabled:hover:bg-teal-700 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
          >
            {assignLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
