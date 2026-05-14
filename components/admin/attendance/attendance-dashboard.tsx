"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DatePickerPopover } from "@/components/ui/date-picker-popover";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { AttendancePageHeader } from "./attendance-page-header";
import { RosterTable } from "./roster-table";
import { UserDetailPanel } from "./user-detail-panel";
import type { AdminDisplayStatus } from "@/lib/attendance/admin-status";

// ── Serialised shapes (mirror the page's serialisation) ────────────────────────

export interface SerializedSummary {
  userId: number;
  status: string;
  totalMinutesWorked: number;
  overtimeMinutes: number;
  lateMinutes: number;
  firstCheckInISO: string | null;
  lastCheckOutISO: string | null;
  sessionCount: number;
  hasMissingCheckout: boolean;
  hasGeofenceViolation: boolean;
  hasManualEntries: boolean;
  exceptionReason: string | null;
}

export interface SerializedRecord {
  id: number;
  userId: number;
  type: string;
  timestampISO: string;
  locationVerified: boolean;
  locationDistanceMeters: number | null;
  photoPath: string | null;
  hasNoLocation: boolean;
  isLate: boolean;
  isOvertime: boolean;
  isOutsideGeofence: boolean;
  isManualEntry: boolean;
  userAgent: string | null;
  deviceLabel: string | null;
  ipAddress: string | null;
  createdAtISO: string;
}

export interface RosterUser {
  id: number;
  name: string;
  role: string;
  attendanceTestUser: boolean;
  attendanceExempt: boolean;
}

export interface RosterFlags {
  geo: boolean;
  manual: boolean;
  yesterday: boolean;
}

export interface RosterRow {
  user: RosterUser;
  summary: SerializedSummary | null;
  records: SerializedRecord[];
  status: AdminDisplayStatus;
  flags: RosterFlags;
  thisWeekMinutes: number; // Mon→viewedDate sum for the user (qualifying status only)
}

// ── Component ─────────────────────────────────────────────────────────────────

interface AttendanceDashboardProps {
  viewedDate: string;
  today: string;
  rows: RosterRow[];
  photoRetentionDays: number;
  otPendingCount: number;
}

type SegmentId = "ALL" | "PRESENT" | "LATE" | "ABSENT" | "FLAGS";

export function AttendanceDashboard({
  viewedDate,
  today,
  rows,
  photoRetentionDays,
  otPendingCount,
}: AttendanceDashboardProps) {
  const router = useRouter();

  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [activeSegment, setActiveSegment] = useState<SegmentId>("ALL");

  // ── Stats (computed from full roster — not affected by segment selection) ──
  // EXEMPT users excluded from stats math. The Total denominator counts only
  // users we expect to attend.
  const stats = useMemo(() => {
    const expected = rows.filter((r) => r.status !== "EXEMPT");
    return {
      total: expected.length,
      lateCount: expected.filter((r) => r.status === "LATE").length,
      absentCount: expected.filter((r) => r.status === "ABSENT").length,
      flagsCount: expected.filter(
        (r) => r.flags.geo || r.flags.manual || r.flags.yesterday,
      ).length,
      presentCount: expected.filter((r) => r.status === "PRESENT").length,
    };
  }, [rows]);

  // Segment filter only — search bar removed in the redesign per
  // docs/mockups/attendance/admin-redesign.html.
  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      switch (activeSegment) {
        case "PRESENT":
          return row.status === "PRESENT";
        case "LATE":
          return row.status === "LATE";
        case "ABSENT":
          return row.status === "ABSENT";
        case "FLAGS":
          return row.flags.geo || row.flags.manual || row.flags.yesterday;
        case "ALL":
        default:
          return true;
      }
    });
  }, [rows, activeSegment]);

  const viewedDateObj = useMemo(() => {
    return new Date(`${viewedDate}T00:00:00+05:30`);
  }, [viewedDate]);

  function handleDateChange(d: Date) {
    const istStr = d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    router.push(`/admin/attendance?date=${istStr}`);
  }

  function shiftDay(days: number) {
    const next = new Date(viewedDateObj);
    next.setDate(next.getDate() + days);
    handleDateChange(next);
  }

  const isToday = viewedDate === today;

  return (
    <div className="min-w-[1100px]">
      <AttendancePageHeader
        activeTab="dashboard"
        otPendingCount={otPendingCount}
      >
        <SegmentRow
          activeSegment={activeSegment}
          onChange={setActiveSegment}
          stats={stats}
        />
        <DateStepper
          viewedDate={viewedDateObj}
          isToday={isToday}
          onPrev={() => shiftDay(-1)}
          onNext={() => shiftDay(1)}
          onPick={handleDateChange}
        />
      </AttendancePageHeader>

      <div className="flex gap-4 p-4">
        <div className="flex-1 min-w-0">
          <RosterTable
            rows={filteredRows}
            selectedUserId={selectedUserId}
            onSelectUser={setSelectedUserId}
          />
        </div>
        <aside className="w-[340px] shrink-0">
          <UserDetailPanel
            row={
              selectedUserId !== null
                ? rows.find((r) => r.user.id === selectedUserId) ?? null
                : null
            }
            photoRetentionDays={photoRetentionDays}
          />
        </aside>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Strip 2 — segment pills
// ────────────────────────────────────────────────────────────────────────

interface SegmentRowProps {
  activeSegment: SegmentId;
  onChange(id: SegmentId): void;
  stats: {
    total: number;
    presentCount: number;
    lateCount: number;
    absentCount: number;
    flagsCount: number;
  };
}

function SegmentRow({ activeSegment, onChange, stats }: SegmentRowProps) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <SegmentPill
        active={activeSegment === "ALL"}
        onClick={() => onChange("ALL")}
        count={stats.total}
      >
        All
      </SegmentPill>
      <SegmentPill
        active={activeSegment === "PRESENT"}
        onClick={() => onChange("PRESENT")}
        count={stats.presentCount}
      >
        Present
      </SegmentPill>
      <SegmentPill
        active={activeSegment === "LATE"}
        onClick={() => onChange("LATE")}
        count={stats.lateCount}
      >
        Late
      </SegmentPill>
      <SegmentPill
        active={activeSegment === "ABSENT"}
        onClick={() => onChange("ABSENT")}
        count={stats.absentCount}
      >
        Absent
      </SegmentPill>
      <SegmentPill
        active={activeSegment === "FLAGS"}
        onClick={() => onChange("FLAGS")}
        count={stats.flagsCount}
      >
        Flags
      </SegmentPill>
    </div>
  );
}

function SegmentPill({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick(): void;
  count: number;
  children: React.ReactNode;
}) {
  if (active) {
    // Single teal element on the page per UI §6.
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center px-3 py-1 text-xs font-medium rounded-md text-white bg-teal-600 hover:bg-teal-700"
      >
        {children}
        <span className="opacity-80 ml-1 tabular-nums">· {count}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 rounded-md"
    >
      {children}
      <span className="text-gray-400 ml-1 tabular-nums">· {count}</span>
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Strip 2 — date stepper (‹ Today · 14 May ›)
// ────────────────────────────────────────────────────────────────────────

function DateStepper({
  viewedDate,
  isToday,
  onPrev,
  onNext,
  onPick,
}: {
  viewedDate: Date;
  isToday: boolean;
  onPrev(): void;
  onNext(): void;
  onPick(d: Date): void;
}) {
  const label = formatStepperLabel(viewedDate, isToday);
  return (
    <div className="inline-flex items-center border border-gray-200 rounded-md bg-white text-xs">
      <button
        type="button"
        onClick={onPrev}
        className="px-2 py-1 text-gray-500 hover:bg-gray-50 hover:text-gray-700"
        aria-label="Previous day"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
      <DatePickerPopover value={viewedDate} onChange={onPick}>
        <button
          type="button"
          className="px-2 py-1 font-medium text-gray-900 border-x border-gray-200 hover:bg-gray-50 inline-flex items-center gap-1"
        >
          {label}
          <ChevronDown className="w-3 h-3 text-gray-400" />
        </button>
      </DatePickerPopover>
      <button
        type="button"
        onClick={isToday ? undefined : onNext}
        disabled={isToday}
        className={`px-2 py-1 ${
          isToday
            ? "text-gray-300 cursor-not-allowed"
            : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
        }`}
        aria-label="Next day"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function formatStepperLabel(d: Date, isToday: boolean): string {
  const dayMonth = d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
  return isToday ? `Today · ${dayMonth}` : dayMonth;
}
