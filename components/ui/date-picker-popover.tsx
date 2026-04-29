"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// ── Helpers (IST-aware, future dates blocked) ───────────────────────────────

function todayIST(): Date {
  const now = new Date();
  const istStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return new Date(istStr + "T00:00:00+05:30");
}

function toISTDateStr(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function sameDay(a: Date, b: Date): boolean {
  return toISTDateStr(a) === toISTDateStr(b);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

const DOW = ["M", "T", "W", "T", "F", "S", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ── Component ───────────────────────────────────────────────────────────────

export function DatePickerPopover({
  value,
  onChange,
  children,
}: {
  value: Date;
  onChange: (date: Date) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(value));

  const today = todayIST();
  const todayStr = toISTDateStr(today);

  function handleOpenChange(next: boolean) {
    if (next) setViewMonth(startOfMonth(value));
    setOpen(next);
  }

  function selectDay(d: Date) {
    onChange(d);
    setOpen(false);
  }

  function selectToday() {
    onChange(today);
    setOpen(false);
  }

  // Build the 6x7 grid: 42 cells starting at Monday on or before viewMonth's first day.
  const monthStart = startOfMonth(viewMonth);
  const leadingBlanks = mondayIndex(monthStart);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(monthStart);
    d.setDate(monthStart.getDate() - leadingBlanks + i);
    cells.push(d);
  }

  const nextMonthStart = addMonths(viewMonth, 1);
  const isNextMonthBlocked = toISTDateStr(nextMonthStart) > todayStr;
  const isOnToday = sameDay(value, today);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {/* render={...} replaces base-ui's default <button>; children must be a single button element */}
      <PopoverTrigger render={children as React.ReactElement} />
      <PopoverContent
        className="w-[244px] p-3 gap-0"
        align="end"
        sideOffset={6}
      >
        {/* Month nav */}
        <div className="flex items-center justify-between mb-2">
          <button
            type="button"
            onClick={() => setViewMonth(addMonths(viewMonth, -1))}
            className="w-[22px] h-[22px] rounded-md text-gray-600 hover:bg-gray-100 inline-flex items-center justify-center cursor-pointer"
            aria-label="Previous month"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-[12px] font-medium text-gray-900">
            {MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
          </span>
          <button
            type="button"
            onClick={() => !isNextMonthBlocked && setViewMonth(addMonths(viewMonth, 1))}
            disabled={isNextMonthBlocked}
            className={cn(
              "w-[22px] h-[22px] rounded-md inline-flex items-center justify-center",
              isNextMonthBlocked
                ? "text-gray-300 cursor-not-allowed"
                : "text-gray-600 hover:bg-gray-100 cursor-pointer",
            )}
            aria-label="Next month"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Day-of-week header (Monday-first) */}
        <div className="grid grid-cols-7 gap-0 mb-1">
          {DOW.map((d, i) => (
            <div
              key={`${d}-${i}`}
              className="h-[20px] text-[9px] font-medium text-gray-400 inline-flex items-center justify-center"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 gap-0">
          {cells.map((d, i) => {
            const inMonth = d.getMonth() === viewMonth.getMonth();
            const isSelected = sameDay(d, value);
            const isToday = sameDay(d, today);
            const isFuture = toISTDateStr(d) > todayStr;

            return (
              <button
                key={i}
                type="button"
                disabled={isFuture}
                onClick={() => !isFuture && selectDay(d)}
                className={cn(
                  "h-[28px] text-[11px] rounded-md inline-flex items-center justify-center",
                  isSelected
                    ? "bg-teal-600 text-white font-medium"
                    : isFuture
                      ? "text-gray-300 cursor-not-allowed"
                      : !inMonth
                        ? "text-gray-300 hover:bg-gray-100 cursor-pointer"
                        : isToday
                          ? "text-gray-700 font-semibold hover:bg-gray-100 cursor-pointer"
                          : "text-gray-700 hover:bg-gray-100 cursor-pointer",
                )}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>

        {/* Footer: Today */}
        <div className="border-t border-gray-100 pt-[8px] mt-[8px] flex justify-end">
          <button
            type="button"
            onClick={selectToday}
            disabled={isOnToday}
            className={cn(
              "text-[11px] rounded-md px-[8px] py-[3px] bg-transparent",
              isOnToday
                ? "text-gray-300 cursor-not-allowed"
                : "text-gray-600 hover:text-gray-900 cursor-pointer",
            )}
          >
            Today
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
