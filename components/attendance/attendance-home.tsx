"use client";

import { useRouter } from "next/navigation";
import { Camera, LogOut } from "lucide-react";
import { BottomNav } from "./bottom-nav";
import { StatusCard } from "./status-card";
import { StatusChip } from "./status-chip";
import {
  formatDuration,
  formatIstClock,
  formatIstShortDate,
  formatIstWeekdayDate,
  shiftCalendarDate,
} from "@/lib/attendance/format";
import type { AttendanceState, SessionPair } from "@/lib/attendance/state";

export interface DaySummary {
  attendanceDate: string;            // "YYYY-MM-DD"
  firstCheckInISO: string | null;
  lastCheckOutISO: string | null;
  totalMinutesWorked: number;
  status: string;
}

interface AttendanceHomeProps {
  state: AttendanceState;
  todaySummary: DaySummary | null;
  weekSummaries: DaySummary[];       // past 7 days, descending, today excluded
  settings: { workStartTime: string; workEndTime: string };
  userName: string;
  today: string;                     // YYYY-MM-DD IST
}

const QUALIFYING_STATUS = new Set(["PRESENT", "LATE", "HALF_DAY"]);

export function AttendanceHome({
  state,
  todaySummary,
  weekSummaries,
  settings,
  userName,
  today,
}: AttendanceHomeProps) {
  const router = useRouter();

  const sessionsToShow: SessionPair[] =
    state.kind === "WORKING" ? state.sessionsBefore : state.sessions;

  const isWorking = state.kind === "WORKING";

  // Yesterday lookup
  const yesterdayStr = shiftCalendarDate(today, 1);
  const yesterday = weekSummaries.find((s) => s.attendanceDate === yesterdayStr) ?? null;

  // This week (Mon → today, including today's summary if it exists)
  const allSummaries = todaySummary
    ? [todaySummary, ...weekSummaries]
    : weekSummaries;
  const thisWeek = computeThisWeek(today, allSummaries);

  // Last 3 calendar days excluding today
  const recentDays: { date: string; summary: DaySummary | null }[] = [];
  for (let i = 1; i <= 3; i++) {
    const d = shiftCalendarDate(today, i);
    recentDays.push({
      date: d,
      summary: weekSummaries.find((s) => s.attendanceDate === d) ?? null,
    });
  }
  const showRecent = recentDays.some((r) => r.summary !== null);

  return (
    <div className="pb-24">
      {/* Header — single row ~56px (Q9) */}
      <header className="flex items-center justify-between mb-4 h-14">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-teal-600 rounded-lg flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 22 22" fill="none">
              <circle cx="11" cy="11" r="7" stroke="white" strokeWidth="1.6" />
              <circle cx="11" cy="11" r="2.2" fill="white" />
              <circle cx="18" cy="11" r="2" fill="white" />
            </svg>
          </div>
          <p className="text-[14px] font-semibold text-gray-900">Attendance</p>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <div className="w-7 h-7 bg-teal-600 rounded-full flex items-center justify-center text-white text-[11px] font-semibold">
            {getInitials(userName)}
          </div>
          <p className="text-[10px] text-gray-400">{formatIstWeekdayDate(today)}</p>
        </div>
      </header>

      {/* Status card */}
      <StatusCard
        state={state}
        workStartTime={settings.workStartTime}
        workEndTime={settings.workEndTime}
      />

      {/* Primary CTA */}
      <div className="mt-4">
        {isWorking ? (
          <CTAButton
            variant="amber"
            icon={<LogOut className="w-5 h-5" />}
            label="Check Out"
            onClick={() => router.push("/attendance/check-out")}
          />
        ) : (
          <CTAButton
            variant="teal"
            icon={<Camera className="w-5 h-5" />}
            label="Check In"
            onClick={() => router.push("/attendance/check-in")}
          />
        )}
      </div>

      {/* Today's Sessions */}
      {sessionsToShow.length > 0 && (
        <section className="mt-5">
          <h3 className="text-[11px] uppercase tracking-wider text-gray-400 mb-2">
            Today's Sessions
          </h3>
          <div className="space-y-2">
            {sessionsToShow.map((s, i) => (
              <SessionRow key={i} index={i + 1} session={s} />
            ))}
          </div>
        </section>
      )}

      {/* Stats grid */}
      <section className="mt-5 grid grid-cols-2 gap-3">
        <StatBox
          label="Yesterday"
          headline={yesterday ? formatDuration(yesterday.totalMinutesWorked) : "—"}
          caption={
            yesterday?.firstCheckInISO && yesterday?.lastCheckOutISO
              ? `${formatIstClock(yesterday.firstCheckInISO)} → ${formatIstClock(yesterday.lastCheckOutISO)}`
              : null
          }
        />
        <StatBox
          label="This Week"
          headline={formatDuration(thisWeek.totalMinutes)}
          caption={
            thisWeek.dayCount > 0
              ? `${thisWeek.dayCount} day${thisWeek.dayCount === 1 ? "" : "s"}`
              : null
          }
        />
      </section>

      {/* Recent Days */}
      {showRecent && (
        <section className="mt-5">
          <h3 className="text-[11px] uppercase tracking-wider text-gray-400 mb-2">
            Recent Days
          </h3>
          <div className="space-y-2">
            {recentDays.map((r) => (
              <RecentDayRow key={r.date} dateStr={r.date} summary={r.summary} />
            ))}
          </div>
        </section>
      )}

      <BottomNav />
    </div>
  );
}

// ─────────────────────────────────────────────
// Internal subcomponents
// ─────────────────────────────────────────────

function CTAButton({
  variant,
  icon,
  label,
  onClick,
}: {
  variant: "teal" | "amber";
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  const colorClasses =
    variant === "teal"
      ? "bg-teal-600 hover:bg-teal-700"
      : "bg-amber-500 hover:bg-amber-600";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full h-[72px] rounded-2xl ${colorClasses} text-white text-[16px] font-semibold flex items-center justify-center gap-2 shadow-sm transition-colors`}
    >
      {icon}
      {label}
    </button>
  );
}

function SessionRow({ index, session }: { index: number; session: SessionPair }) {
  return (
    <div className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">
          Session {index}
        </p>
        <p className="text-[13px] text-gray-700 tabular-nums">
          {formatIstClock(session.checkInISO)} → {formatIstClock(session.checkOutISO)}
        </p>
      </div>
      <p className="text-[13px] font-semibold text-gray-900 tabular-nums">
        {formatDuration(session.durationMinutes)}
      </p>
    </div>
  );
}

function StatBox({
  label,
  headline,
  caption,
}: {
  label: string;
  headline: string;
  caption: string | null;
}) {
  return (
    <div className="p-3 bg-white border border-gray-200 rounded-lg">
      <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">{label}</p>
      <p className="text-[18px] font-semibold text-gray-900 tabular-nums">{headline}</p>
      {caption && (
        <p className="text-[11px] text-gray-500 mt-0.5 tabular-nums">{caption}</p>
      )}
    </div>
  );
}

function RecentDayRow({
  dateStr,
  summary,
}: {
  dateStr: string;
  summary: DaySummary | null;
}) {
  const dateLabel = formatIstShortDate(dateStr);
  const hasTimeRange = summary?.firstCheckInISO && summary?.lastCheckOutISO;
  return (
    <div className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg">
      <div className="min-w-0">
        <p className="text-[12.5px] font-semibold text-gray-900">{dateLabel}</p>
        {hasTimeRange ? (
          <p className="text-[11px] text-gray-500 tabular-nums">
            {formatIstClock(summary!.firstCheckInISO!)} → {formatIstClock(summary!.lastCheckOutISO!)}
          </p>
        ) : (
          <p className="text-[11px] text-gray-400 tabular-nums">—</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {summary && (
          <p className="text-[12.5px] font-semibold text-gray-900 tabular-nums">
            {formatDuration(summary.totalMinutesWorked)}
          </p>
        )}
        {summary && <StatusChip status={summary.status} />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function computeThisWeek(
  today: string,
  summaries: readonly DaySummary[],
): { totalMinutes: number; dayCount: number } {
  // ISO weekday derivation. UTC-anchor a Date for the calendar day,
  // then compute days since Monday. IST has no DST so this is stable.
  const [y, m, d] = today.split("-").map(Number);
  const utcDate = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  const dayOfWeek = utcDate.getUTCDay();      // 0=Sun, …, 6=Sat
  const daysFromMon = (dayOfWeek + 6) % 7;     // 0 if Mon, 6 if Sun

  const weekDates: string[] = [];
  for (let i = 0; i <= daysFromMon; i++) {
    weekDates.push(shiftCalendarDate(today, i));
  }
  const inWeekSet = new Set(weekDates);
  const qualifying = summaries.filter(
    (s) => inWeekSet.has(s.attendanceDate) && QUALIFYING_STATUS.has(s.status),
  );
  return {
    totalMinutes: qualifying.reduce((sum, s) => sum + s.totalMinutesWorked, 0),
    dayCount: qualifying.length,
  };
}
