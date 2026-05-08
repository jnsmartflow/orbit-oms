"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CalendarGrid } from "./calendar-grid";
import { BottomNav } from "./bottom-nav";
import { DayDetailCard } from "./day-detail-card";
import {
  addMonths,
  compareMonths,
  formatMonthLabel,
  getMonthGrid,
  type MonthRef,
} from "@/lib/attendance/calendar";

export interface DaySummary {
  attendanceDate: string;
  status: string;
  totalMinutesWorked: number;
  overtimeMinutes: number;
  lateMinutes: number;
  firstCheckInISO: string | null;
  lastCheckOutISO: string | null;
  sessionCount: number;
  exceptionReason: string | null;
}

export interface DayRecord {
  attendanceDate: string;
  type: string;
  timestampISO: string;
  locationVerified: boolean;
  hasNoLocation: boolean;
}

interface HistoryCalendarProps {
  viewedMonth: MonthRef;
  minMonth: MonthRef;
  currentMonth: MonthRef;
  summaries: DaySummary[];
  records: DayRecord[];
  userName: string;
  today: string;
}

const QUALIFYING_STATUS = new Set(["PRESENT", "LATE", "HALF_DAY"]);

export function HistoryCalendar({
  viewedMonth,
  minMonth,
  currentMonth,
  summaries,
  records,
  userName,
  today,
}: HistoryCalendarProps) {
  // Initial selectedDate: today if today falls in the viewed month, else
  // null (Q2). Component remounts on month change via key in page.tsx —
  // useState's initializer fires fresh per mount.
  const todayMonthStr = today.slice(0, 7);
  const viewedMonthStr = `${viewedMonth.year}-${String(viewedMonth.month).padStart(2, "0")}`;
  const initialSelected = todayMonthStr === viewedMonthStr ? today : null;

  const [selectedDate, setSelectedDate] = useState<string | null>(initialSelected);

  const statusByDate = new Map(summaries.map((s) => [s.attendanceDate, s.status]));
  const cells = getMonthGrid(viewedMonth);

  const daysPresent = summaries.filter((s) => QUALIFYING_STATUS.has(s.status)).length;
  const presentSubtitle =
    daysPresent === 0
      ? null
      : daysPresent === 1
        ? "1 day present"
        : `${daysPresent} days present`;

  const prevMonth = addMonths(viewedMonth, -1);
  const nextMonth = addMonths(viewedMonth, 1);
  const canGoPrev = compareMonths(prevMonth, minMonth) >= 0;
  const canGoNext = compareMonths(nextMonth, currentMonth) <= 0;
  const prevHref = `/attendance/history?month=${prevMonth.year}-${String(prevMonth.month).padStart(2, "0")}`;
  const nextHref = `/attendance/history?month=${nextMonth.year}-${String(nextMonth.month).padStart(2, "0")}`;

  return (
    <div className="pb-24">
      {/* Header — same 56px P5 pattern */}
      <header className="flex items-center justify-between mb-3 h-14">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-teal-600 rounded-lg flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 22 22" fill="none">
              <circle cx="11" cy="11" r="7" stroke="white" strokeWidth="1.6" />
              <circle cx="11" cy="11" r="2.2" fill="white" />
              <circle cx="18" cy="11" r="2" fill="white" />
            </svg>
          </div>
          <p className="text-[14px] font-semibold text-gray-900">History</p>
        </div>
        <div className="w-7 h-7 bg-teal-600 rounded-full flex items-center justify-center text-white text-[11px] font-semibold">
          {getInitials(userName)}
        </div>
      </header>

      {/* Month nav */}
      <div className="flex items-center justify-between mb-1">
        <ChevronButton href={prevHref} disabled={!canGoPrev} ariaLabel="Previous month">
          <ChevronLeft className="w-4 h-4" />
        </ChevronButton>
        <p className="text-[15px] font-semibold text-gray-900 tabular-nums">
          {formatMonthLabel(viewedMonth)}
        </p>
        <ChevronButton href={nextHref} disabled={!canGoNext} ariaLabel="Next month">
          <ChevronRight className="w-4 h-4" />
        </ChevronButton>
      </div>

      {/* Days-present caption (or empty spacer for layout stability) */}
      <p
        className="text-[11px] text-gray-400 text-center mb-3 tabular-nums h-4"
        aria-live="polite"
      >
        {presentSubtitle ?? ""}
      </p>

      <CalendarGrid
        cells={cells}
        statusByDate={statusByDate}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
      />

      <div className="mt-4">
        <DayDetailCard
          selectedDate={selectedDate}
          summary={
            selectedDate
              ? summaries.find((s) => s.attendanceDate === selectedDate)
              : undefined
          }
          records={records}
          today={today}
        />
      </div>

      <BottomNav />
    </div>
  );
}

function ChevronButton({
  href,
  disabled,
  ariaLabel,
  children,
}: {
  href: string;
  disabled: boolean;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span
        aria-label={ariaLabel}
        aria-disabled
        className="w-10 h-10 flex items-center justify-center rounded-md text-gray-300"
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className="w-10 h-10 flex items-center justify-center rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
    >
      {children}
    </Link>
  );
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
