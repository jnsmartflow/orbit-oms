"use client";

// Tint Manager — the table's Slot cell (2026-10-01, tabs build step 6 — plan §A,
// mockup .slotc). The bill's FLOOR dispatch window (dispatchTargetDate +
// dispatchWindowId), never the legacy slotId.
//
//   set    → "DD-MM · HH:MM", a quiet chip that borders on hover;
//   unset  → a dashed "No slot";
//   ONE click opens Floor's DispatchSlotPicker (via SlotPickerButton) — same day
//   tiles, same times, commit-on-tap, no confirm (CLAUDE_FLOOR §4.6). No pencil:
//   the dashed / hover border IS the affordance (owner decision 4).
//   Without tint_slot the value shows read-only and nothing opens.
//
// The click never selects the row: the cell stops propagation, so setting a
// slot does not tick the bill as a side effect.

import { cn } from "@/lib/utils";
import { SlotPickerButton } from "@/components/floor/slot-picker-button";
import type { DispatchSlotValue, DispatchWindow } from "@/components/floor/dispatch-slot-picker";

/** "2026-10-03" + "16:00" → "03-10 · 16:00" (the picker's own trigger format). */
export function slotLabel(date: string, windowTime: string | null): string {
  const [, m, d] = date.split("-");
  return `${d}-${m}${windowTime ? ` · ${windowTime}` : ""}`;
}

/** The picker's value for a bill, or null when it has no full window. */
export function slotValueOf(
  date: string | null,
  windowId: number | null,
  windowTime: string | null,
): DispatchSlotValue | null {
  if (date === null || windowId === null) return null;
  return { date, dispatchWindowId: windowId, windowTime: windowTime ?? "" };
}

export function BoardSlotCell({
  date,
  windowId,
  windowTime,
  windows,
  canSlot,
  disabled,
  onPick,
}: {
  date:       string | null;
  windowId:   number | null;
  windowTime: string | null;
  windows:    DispatchWindow[];
  /** tint_manager canEdit && tint_slot canEdit. */
  canSlot:    boolean;
  /** A write is in flight. */
  disabled?:  boolean;
  onPick:     (v: DispatchSlotValue) => void;
}) {
  const has = date !== null;
  const text = has ? slotLabel(date, windowTime) : "No slot";

  if (!canSlot) {
    return has
      ? <span className="text-[11px] text-[#4b5563] tabular-nums">{text}</span>
      : <span className="text-[11px] text-[#9ca3af]">No slot</span>;
  }

  return (
    <span onClick={(e) => e.stopPropagation()} className="inline-flex max-w-full">
      <SlotPickerButton
        value={slotValueOf(date, windowId, windowTime)}
        onPick={onPick}
        windows={windows}
        disabled={disabled || windows.length === 0}
        popoverDir="down"
        popoverAlign="left"
        className={cn(
          "max-w-full truncate rounded-md px-[7px] py-[3px] text-left text-[11px] transition-colors",
          has
            ? "border border-transparent text-ink-700 tabular-nums hover:border-ink-200 hover:bg-white"
            : "border border-dashed border-ink-200 font-semibold text-ink-400 hover:border-brand-600 hover:text-brand-700",
        )}
      >
        {text}
      </SlotPickerButton>
    </span>
  );
}
