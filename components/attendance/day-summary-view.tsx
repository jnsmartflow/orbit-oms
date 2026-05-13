"use client";

import { CheckCircle2, Clock } from "lucide-react";
import { StatusChip } from "./status-chip";
import {
  format24To12,
  formatDuration,
  formatIstClock,
  parseTimeToMin,
  shiftCalendarDate,
} from "@/lib/attendance/format";
import type { DaySummary } from "./attendance-home";

export type DaySummaryOtOutcome = {
  status: "NOT_CLAIMED" | "AUTO_CREDITED" | "AUTO_CREDITED_GRACE" | "PENDING";
  minutesCredited: number;
  graceUsedThisMonth: number;
  graceLimit: number;
};

interface DaySummaryViewProps {
  userName: string;
  today: string;
  totalMinutesWorked: number;
  overtimeMinutes: number;
  firstCheckInISO: string;
  lastCheckOutISO: string;
  status: string;
  workStartTime: string;
  workEndTime: string;
  weekSummaries: DaySummary[]; // includes today + past 6
  otOutcome?: DaySummaryOtOutcome;
  onDone(): void;
}

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

// Hard cap for bar heights — 600 minutes (10h). Lets a normal 9.5h
// shift fill ~95% of the bar; overtime tops out cleanly at 100%.
const BAR_MAX_MINUTES = 600;

export function DaySummaryView({
  userName,
  today,
  totalMinutesWorked,
  overtimeMinutes,
  firstCheckInISO,
  lastCheckOutISO,
  status,
  workStartTime,
  workEndTime,
  weekSummaries,
  otOutcome,
  onDone,
}: DaySummaryViewProps) {
  const firstName = userName.split(" ")[0] || userName || "—";
  const scheduledMinutes =
    parseTimeToMin(workEndTime) - parseTimeToMin(workStartTime);

  const monToTodayDates = computeMonToToday(today);
  const summariesByDate = new Map(weekSummaries.map((s) => [s.attendanceDate, s]));

  return (
    <div>
      {/* Top check icon — amber for "day done" semantic (one-amber rule) */}
      <header className="flex flex-col items-center text-center pt-2 pb-5">
        <div className="w-24 h-24 rounded-full bg-amber-100 flex items-center justify-center mb-3">
          <CheckCircle2 className="w-14 h-14 text-amber-600" strokeWidth={1.75} />
        </div>
        <h2 className="text-[22px] font-semibold text-gray-900 mb-1">Day complete</h2>
        <p className="text-[13px] text-gray-500 tabular-nums">
          Checked out at {formatIstClock(lastCheckOutISO)}
        </p>
      </header>

      {otOutcome && otOutcome.status !== "NOT_CLAIMED" && (
        <OtOutcomeBanner outcome={otOutcome} />
      )}

      {/* Big card — slate gradient + dot pattern (matches P5 status-card) */}
      <div className="relative overflow-hidden rounded-2xl text-white shadow-sm bg-gradient-to-br from-slate-800 to-slate-900 mb-4">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "16px 16px",
          }}
        />
        <div className="relative px-5 py-6">
          <p className="text-[11px] uppercase tracking-wider text-white/60 mb-1">
            You worked
          </p>
          <p className="text-[52px] font-semibold tabular-nums leading-none mb-2">
            {formatDuration(totalMinutesWorked)}
          </p>
          <p className="text-[14px] text-white/80 tabular-nums">
            {formatIstClock(firstCheckInISO)} → {formatIstClock(lastCheckOutISO)}
          </p>
        </div>
      </div>

      {/* 3-stat grid */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        <StatBox label="Scheduled" valueText={formatDuration(scheduledMinutes)} />
        <StatBox
          label="Overtime"
          valueText={overtimeMinutes > 0 ? `+${formatDuration(overtimeMinutes)}` : "—"}
          valueClass={overtimeMinutes > 0 ? "text-emerald-600" : "text-gray-400"}
        />
        <StatBox label="Status" valueNode={<StatusChip status={status} />} />
      </div>

      {/* This Week mini chart — Mon → today (Q1) */}
      <section className="mb-5">
        <h3 className="text-[11px] uppercase tracking-wider text-gray-400 mb-2">
          This Week
        </h3>
        <div className="flex items-end justify-start gap-2">
          {monToTodayDates.map((date, i) => {
            const isToday = date === today;
            const summary = summariesByDate.get(date);
            const minutes = isToday ? totalMinutesWorked : summary?.totalMinutesWorked ?? 0;
            const heightPct =
              minutes > 0 ? Math.min(1, minutes / BAR_MAX_MINUTES) * 100 : 0;
            const hasData = isToday || summary !== undefined;
            return (
              <div key={date} className="flex flex-col items-center gap-1.5 flex-1 max-w-[36px]">
                <div className="h-12 w-full bg-gray-100 rounded-sm flex items-end overflow-hidden">
                  {hasData && minutes > 0 && (
                    <div
                      className={`w-full rounded-sm ${isToday ? "bg-teal-500" : "bg-gray-400"}`}
                      style={{ height: `${heightPct}%` }}
                    />
                  )}
                </div>
                <span
                  className={`text-[10px] tabular-nums ${
                    isToday ? "text-teal-600 font-semibold" : "text-gray-400"
                  }`}
                >
                  {WEEKDAY_LABELS[i]}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Sign-off */}
      <p className="text-center text-[14px] text-gray-600 mb-5">
        See you tomorrow, {firstName}. 👋
      </p>

      {/* Done CTA — gray-900 (NOT teal, NOT amber). Per UI §10 modal save pattern. */}
      <button
        type="button"
        onClick={onDone}
        className="w-full h-[60px] rounded-2xl bg-gray-900 hover:bg-gray-800 text-white text-[16px] font-semibold transition-colors shadow-sm"
      >
        Done
      </button>
    </div>
  );
}

function OtOutcomeBanner({ outcome }: { outcome: DaySummaryOtOutcome }) {
  let bg: string;
  let border: string;
  let text: string;
  let Icon: typeof CheckCircle2;
  let label: string;
  switch (outcome.status) {
    case "AUTO_CREDITED":
      bg = "bg-green-50";
      border = "border-green-200";
      text = "text-green-900";
      Icon = CheckCircle2;
      label = `OT credited: ${outcome.minutesCredited} min`;
      break;
    case "AUTO_CREDITED_GRACE":
      bg = "bg-amber-50";
      border = "border-amber-200";
      text = "text-amber-900";
      Icon = CheckCircle2;
      label = `OT credited under grace · ${outcome.graceUsedThisMonth} of ${outcome.graceLimit} used this month`;
      break;
    case "PENDING":
      bg = "bg-amber-50";
      border = "border-amber-200";
      text = "text-amber-900";
      Icon = Clock;
      label = "OT submitted for admin approval · grace limit reached";
      break;
    default:
      return null;
  }
  return (
    <div
      className={`rounded-lg border p-3 flex items-center gap-2 text-[14px] font-medium mb-4 ${bg} ${border} ${text}`}
    >
      <Icon className="w-[18px] h-[18px] shrink-0" />
      <span>{label}</span>
    </div>
  );
}

function StatBox({
  label,
  valueText,
  valueNode,
  valueClass,
}: {
  label: string;
  valueText?: string;
  valueNode?: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="p-2.5 bg-white border border-gray-200 rounded-lg">
      <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">{label}</p>
      {valueNode ?? (
        <p className={`text-[14px] font-semibold tabular-nums ${valueClass ?? "text-gray-900"}`}>
          {valueText}
        </p>
      )}
    </div>
  );
}

/**
 * Returns calendar dates from current Monday through `today`, oldest first.
 * Length is 1–7 depending on weekday (Q1: Mon→today only, no future days).
 */
function computeMonToToday(today: string): string[] {
  const [y, m, d] = today.split("-").map(Number);
  const utcDate = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  const dayOfWeek = utcDate.getUTCDay();   // 0=Sun, …, 6=Sat
  const daysFromMon = (dayOfWeek + 6) % 7;  // 0 if Mon, 6 if Sun
  const dates: string[] = [];
  for (let i = daysFromMon; i >= 0; i--) {
    dates.push(shiftCalendarDate(today, i));
  }
  return dates;
}
