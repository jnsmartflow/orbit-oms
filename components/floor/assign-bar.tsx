"use client";

// Floor Control — the sticky assignment bar (design §7.8, mockup 01-board.html
// `.bulk`). Rises when 1+ rows are selected. He works in BULK: there is no
// per-row release button and no per-row slot picker on the floor.
//
// Button logic mirrors the mockup floorBar():
//   - all selected are With-picker  → main button "Reassign" + Unassign shown
//   - selection includes a With-picker + a Waiting → "Assign" + Unassign + note
//   - all Waiting                    → "Assign", no Unassign, no note
// Assign/Reassign both resolve to "put every selected bill under this picker"
// (the page unassigns any already-assigned ones first, then assigns the batch —
// through the EXISTING Picking endpoints, unchanged).
//
// The bar also carries Mark urgent · Hold · Change slot (design §7.8), which go
// through /api/floor/actions.

import { useState } from "react";
import { DispatchSlotPicker, type DispatchWindow } from "@/components/support/dispatch-slot-picker";
import { sumLitres } from "./status-pill";
import type { FloorBoardRow, FloorPicker } from "@/lib/floor/types";

export function AssignBar({
  selectedRows,
  pickers,
  windows,
  onAssign,
  onUnassign,
  onMarkUrgent,
  onHold,
  onChangeSlot,
  onClear,
}: {
  selectedRows: FloorBoardRow[];
  pickers: FloorPicker[];
  windows: DispatchWindow[];
  onAssign: (pickerId: number) => void;
  onUnassign: () => void;
  onMarkUrgent: () => void;
  onHold: () => void;
  onChangeSlot: (date: string, windowId: number) => void;
  onClear: () => void;
}) {
  const [pickerId, setPickerId] = useState<number | "">("");

  const count = selectedRows.length;
  const litres = sumLitres(selectedRows);
  const hasAssigned = selectedRows.some((r) => r.isAssigned);
  const hasWaiting = selectedRows.some((r) => !r.isAssigned);
  const allAssigned = count > 0 && selectedRows.every((r) => r.isAssigned);
  const mixed = hasAssigned && hasWaiting;
  const mainLabel = allAssigned ? "Reassign" : "Assign";

  const ghostBtn = "h-[30px] rounded-[6px] border border-gray-200 bg-white px-[13px] text-[11.5px] text-gray-500 hover:border-gray-300 hover:text-gray-700";

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t border-gray-200 bg-white px-4 py-[11px] text-[12px] shadow-[0_-4px_16px_rgba(0,0,0,0.05)]">
      <span className="font-semibold text-gray-900">{count} selected</span>
      <span className="text-[11px] text-gray-400 tabular-nums">{litres} L</span>
      {mixed && <span className="text-[10.5px] text-[#6d28d9]">includes bills a picker already has</span>}

      {/* Secondary bulk actions (design §7.8). */}
      <div className="ml-auto flex items-center gap-2">
        <button type="button" className={ghostBtn} onClick={onMarkUrgent}>
          Mark urgent
        </button>
        <button type="button" className={ghostBtn} onClick={onHold}>
          Hold
        </button>
        <span className="flex items-center gap-1.5">
          <span className="text-[11.5px] text-gray-500">Change slot</span>
          <DispatchSlotPicker
            value={null}
            onChange={(v) => v && onChangeSlot(v.date, v.dispatchWindowId)}
            windows={windows}
            popoverDir="up"
            popoverAlign="right"
          />
        </span>

        <span className="mx-1 h-5 w-px bg-gray-200" />

        {/* Assignment group. */}
        <span className="text-[11.5px] text-gray-500">assign to</span>
        <select
          value={pickerId}
          onChange={(e) => setPickerId(e.target.value === "" ? "" : Number(e.target.value))}
          className="h-[30px] cursor-pointer rounded-[6px] border border-gray-300 bg-white px-2 text-[11.5px] text-gray-700"
        >
          <option value="">Choose picker</option>
          {pickers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.onHand === 0 ? " - free" : ` - ${p.onHand} on hand`}
            </option>
          ))}
        </select>
        {hasAssigned && (
          <button type="button" className={ghostBtn} onClick={onUnassign}>
            Unassign
          </button>
        )}
        <button type="button" className={ghostBtn} onClick={onClear}>
          Clear
        </button>
        <button
          type="button"
          disabled={pickerId === ""}
          onClick={() => pickerId !== "" && onAssign(pickerId)}
          className="h-[30px] rounded-[6px] bg-teal-600 px-[13px] text-[11.5px] font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {mainLabel}
        </button>
      </div>
    </div>
  );
}
