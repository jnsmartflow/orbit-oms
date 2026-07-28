"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

const GRACE_MINUTES = 15;

interface SlotTab {
  id: number;
  name: string;
  sortOrder: number;
  slotTime: string;
  isNextDay: boolean;
  isUrgent: boolean;
  pickedCount: number;
  totalCount: number;
}

interface WarehouseSlotTabsProps {
  slots: SlotTab[];
  active: number | null;
  onChange: (id: number) => void;
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

export function WarehouseSlotTabs({ slots, active, onChange, isHistoryView = false }: WarehouseSlotTabsProps) {
  if (slots.length === 0) return null;

  const closedIds = useMemo(() => {
    if (isHistoryView) return new Set<number>();
    return new Set(
      slots.filter((s) => isSlotClosed(s.slotTime, s.isNextDay)).map((s) => s.id),
    );
  }, [slots, isHistoryView]);

  return (
    <div className="flex items-center gap-4 text-[11px]">
      {slots.map((slot) => {
        const isActive = active === slot.id;
        const isClosed = closedIds.has(slot.id);

        return (
          <button
            key={slot.id}
            type="button"
            onClick={() => onChange(slot.id)}
            className={cn(
              "pb-1.5 transition-colors flex items-center gap-1.5",
              isClosed
                ? "text-gray-300 opacity-60"
                : isActive
                  ? "font-semibold text-gray-800 border-b-2 border-gray-800"
                  : "text-gray-400 hover:text-gray-600",
            )}
          >
            <span>{slot.name}</span>
            {isClosed && (
              <span className="text-[9px] text-gray-400">Closed</span>
            )}
            {!isClosed && slot.isUrgent && (
              <span className="text-[9px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                urgent
              </span>
            )}
            {!isClosed && (
              <span className={cn("text-[10px]", isActive ? "text-gray-500" : "text-gray-300")}>
                {slot.pickedCount}/{slot.totalCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
