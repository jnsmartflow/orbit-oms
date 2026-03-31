"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

const GRACE_MINUTES = 15;

interface SlotInfo {
  id: number;
  name: string;
  sortOrder: number;
  slotTime: string;
  isNextDay: boolean;
  countdown: string;
  isUrgent: boolean;
  isDone: boolean;
  pickedCount: number;
  totalCount: number;
}

interface SlotBarProps {
  slots: SlotInfo[];
  selected: number | null;
  onSelect: (id: number | null) => void;
  isHistoryView?: boolean;
}

function isSlotClosed(slotTime: string, isNextDay: boolean): boolean {
  if (isNextDay) return false;
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
  );
  const [h, m] = slotTime.split(":").map(Number);
  const deadline = new Date(now);
  deadline.setHours(h, m + GRACE_MINUTES, 0, 0);
  return now > deadline;
}

export function SlotBar({ slots, selected, onSelect, isHistoryView = false }: SlotBarProps) {
  if (slots.length === 0) return null;

  const closedIds = useMemo(() => {
    if (isHistoryView) return new Set<number>();
    return new Set(
      slots.filter((s) => isSlotClosed(s.slotTime, s.isNextDay)).map((s) => s.id),
    );
  }, [slots, isHistoryView]);

  return (
    <div className="flex gap-2">
      {slots.map((slot) => {
        const isSelected = selected === slot.id;
        const isClosed = closedIds.has(slot.id);
        const pct =
          slot.totalCount > 0
            ? (slot.pickedCount / slot.totalCount) * 100
            : 0;

        return (
          <button
            key={slot.id}
            type="button"
            onClick={() => onSelect(isSelected ? null : slot.id)}
            className={cn(
              "flex-1 rounded-lg border px-3 py-2 text-left transition-colors",
              isClosed
                ? "bg-gray-50 border-gray-100 opacity-50"
                : slot.isDone
                  ? "bg-gray-50 border-gray-100 opacity-50"
                  : slot.isUrgent
                    ? "bg-red-50 border-red-200"
                    : isSelected
                      ? "bg-white border-gray-400"
                      : "bg-white border-gray-200 hover:border-gray-300",
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-gray-700">
                {slot.name}
              </span>
              <span
                className={cn(
                  "text-[10px] font-medium",
                  isClosed
                    ? "text-gray-400"
                    : slot.isDone
                      ? "text-gray-400"
                      : slot.isUrgent
                        ? "text-red-600"
                        : "text-gray-400",
                )}
              >
                {isClosed ? "Closed" : slot.isDone ? "✓" : slot.countdown}
              </span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[10px] text-gray-400">
                {slot.pickedCount} of {slot.totalCount}
              </span>
              <div className="w-10 h-1 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    slot.isUrgent ? "bg-red-400" : "bg-gray-300",
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
