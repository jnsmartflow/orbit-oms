"use client";

// The header date stepper — ‹ · "Today · 31 Jul" (opens a picker) · ›
//
// EXTRACTED VERBATIM from components/universal-header.tsx (2026-07-31), along
// with the four date helpers that only ever served it. A MOVE, not a rewrite:
// same markup, same class strings, same label rules, same "can't step past
// today" behaviour. UniversalHeader renders it where the inline block was.
//
// Extracted for the same reason as HeaderFilter: the Billing tab row hosts the
// SAME control, and two copies of a date rule drift. In particular the IST
// handling below is easy to get subtly wrong twice.

import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { DatePickerPopover } from "@/components/ui/date-picker-popover";

// ⚠ These four are COPIED CHARACTER-FOR-CHARACTER from universal-header.tsx.
// Do not "tidy" them. `en-CA` yields YYYY-MM-DD for comparison; `en-IN` yields
// the display form. Swapping either locale silently changes what the stepper
// shows or which day it thinks is today.
function getTodayIST(): Date {
  const now = new Date();
  const istStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return new Date(istStr + "T00:00:00+05:30");
}

function toISTDateStr(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function formatDateShort(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

function shiftDay(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

export function HeaderDateStepper({
  currentDate,
  onDateChange,
}: {
  currentDate: Date;
  onDateChange: (date: Date) => void;
}) {
  const todayIST = getTodayIST();
  const todayStr = toISTDateStr(todayIST);
  const currentStr = toISTDateStr(currentDate);
  const yesterdayStr = toISTDateStr(shiftDay(todayIST, -1));
  const isToday = currentStr === todayStr;

  const dateLabel = isToday
    ? `Today · ${formatDateShort(currentDate)}`
    : currentStr === yesterdayStr
      ? `Yesterday · ${formatDateShort(currentDate)}`
      : formatDateShort(currentDate);

  return (
    <div className="inline-flex items-center gap-0">
      <button
        onClick={() => onDateChange(shiftDay(currentDate, -1))}
        className="px-[6px] py-[3px] text-[10px] text-gray-400 border border-gray-200 rounded-l-[4px] cursor-pointer hover:bg-gray-50"
      >
        <ChevronLeft size={12} />
      </button>
      <DatePickerPopover value={currentDate} onChange={onDateChange}>
        <button
          type="button"
          className="px-[10px] py-[3px] text-[10px] font-medium text-gray-900 border-t border-b border-gray-200 hover:bg-gray-50 cursor-pointer inline-flex items-center gap-[3px]"
        >
          {dateLabel}
          <ChevronDown size={10} className="text-gray-400" />
        </button>
      </DatePickerPopover>
      <button
        onClick={() => !isToday && onDateChange(shiftDay(currentDate, 1))}
        className={`px-[6px] py-[3px] text-[10px] text-gray-400 border border-gray-200 rounded-r-[4px] ${
          isToday
            ? "opacity-40 cursor-not-allowed pointer-events-none"
            : "cursor-pointer hover:bg-gray-50"
        }`}
      >
        <ChevronRight size={12} />
      </button>
    </div>
  );
}
