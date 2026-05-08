"use client";

import { AlertTriangle, Check } from "lucide-react";
import { StatusChip } from "./status-chip";
import { LiveTimer } from "./live-timer";
import { formatDuration, formatIstClock } from "@/lib/attendance/format";
import type { DayRecord, DaySummary } from "./history-calendar";

interface DayDetailCardProps {
  selectedDate: string | null;
  summary: DaySummary | undefined;
  records: DayRecord[];
  today: string;
}

const IST_TZ = "Asia/Kolkata";
const weekdayFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST_TZ,
  weekday: "long",
});
const dayMonthFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST_TZ,
  day: "numeric",
  month: "long",
});

// "2026-05-07" → "Thursday · 7 May" (en-GB puts day before month).
function formatDayHeader(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  return `${weekdayFormatter.format(date)} · ${dayMonthFormatter.format(date)}`;
}

export function DayDetailCard({
  selectedDate,
  summary,
  records,
  today,
}: DayDetailCardProps) {
  if (!selectedDate) {
    return (
      <p className="text-center text-[12px] italic text-gray-400 py-6">
        Tap a day to see details
      </p>
    );
  }

  const isToday = selectedDate === today;
  const dayRecords = records.filter((r) => r.attendanceDate === selectedDate);
  const firstIn = dayRecords.find((r) => r.type === "CHECK_IN") ?? null;
  const lastOut =
    [...dayRecords].reverse().find((r) => r.type === "CHECK_OUT") ?? null;

  // ── Today-specific states (Q5b) ─────────────────────────────────────────
  if (isToday && !firstIn) {
    return (
      <DetailShell selectedDate={selectedDate}>
        <p className="text-[13px] text-gray-500 py-2">No check-in yet today</p>
      </DetailShell>
    );
  }

  if (isToday && firstIn && !lastOut) {
    return (
      <DetailShell
        selectedDate={selectedDate}
        rightChip={
          <span className="inline-block whitespace-nowrap font-semibold rounded border text-[10.5px] px-2 py-0.5 bg-teal-50 border-teal-200 text-teal-700">
            Currently working
          </span>
        }
      >
        <p className="text-[24px] font-semibold text-gray-900 tabular-nums leading-none mb-3">
          <LiveTimer startISO={firstIn.timestampISO} />
        </p>
        <DetailRows firstIn={firstIn} lastOut={null} activeSession />
      </DetailShell>
    );
  }

  // ── No data (past or future day with nothing recorded) ──────────────────
  if (!summary && dayRecords.length === 0) {
    return (
      <DetailShell selectedDate={selectedDate}>
        <p className="text-[13px] text-gray-500 py-2">No data for this day</p>
      </DetailShell>
    );
  }

  // ── ABSENT / HOLIDAY / ON_LEAVE — status pill + optional reason ─────────
  if (
    summary?.status === "ABSENT" ||
    summary?.status === "HOLIDAY" ||
    summary?.status === "ON_LEAVE"
  ) {
    return (
      <DetailShell
        selectedDate={selectedDate}
        rightChip={<StatusChip status={summary.status} />}
      >
        {summary.exceptionReason && (
          <p className="text-[13px] text-gray-500 py-2">{summary.exceptionReason}</p>
        )}
      </DetailShell>
    );
  }

  // ── Standard display: PRESENT / LATE / HALF_DAY / INCOMPLETE ────────────
  return (
    <DetailShell
      selectedDate={selectedDate}
      rightChip={summary ? <StatusChip status={summary.status} /> : undefined}
    >
      {summary && (
        <p className="text-[24px] font-semibold text-gray-900 tabular-nums leading-none mb-3">
          {formatDuration(summary.totalMinutesWorked)}
        </p>
      )}
      <DetailRows firstIn={firstIn} lastOut={lastOut} summary={summary} />
    </DetailShell>
  );
}

function DetailShell({
  selectedDate,
  rightChip,
  children,
}: {
  selectedDate: string;
  rightChip?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <header className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-[13.5px] font-semibold text-gray-900">
          {formatDayHeader(selectedDate)}
        </h3>
        {rightChip}
      </header>
      {children}
    </div>
  );
}

function DetailRows({
  firstIn,
  lastOut,
  summary,
  activeSession,
}: {
  firstIn: DayRecord | null;
  lastOut: DayRecord | null;
  summary?: DaySummary;
  activeSession?: boolean;
}) {
  return (
    <div className="space-y-1 mt-2">
      <Row
        label="Check In"
        value={firstIn ? formatIstClock(firstIn.timestampISO) : "—"}
        verified={firstIn ? firstIn.locationVerified : undefined}
      />
      <Row
        label="Check Out"
        value={
          lastOut
            ? formatIstClock(lastOut.timestampISO)
            : activeSession
              ? "—"
              : "Missing"
        }
        valueClass={!lastOut && !activeSession ? "text-red-600" : undefined}
        valueNote={activeSession ? "Active session" : undefined}
        verified={lastOut ? lastOut.locationVerified : undefined}
      />
      {summary && summary.overtimeMinutes > 0 && (
        <Row
          label="Overtime"
          value={`+${formatDuration(summary.overtimeMinutes)}`}
          valueClass="text-emerald-600"
        />
      )}
      {summary && summary.lateMinutes > 0 && (
        <Row
          label="Late"
          value={`+${formatDuration(summary.lateMinutes)}`}
          valueClass="text-amber-600"
        />
      )}
    </div>
  );
}

function Row({
  label,
  value,
  valueClass,
  valueNote,
  verified,
}: {
  label: string;
  value: string;
  valueClass?: string;
  valueNote?: string;
  verified?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1 text-[12.5px]">
      <span className="text-gray-500">{label}</span>
      <span
        className={`flex items-center gap-1.5 font-medium tabular-nums ${
          valueClass ?? "text-gray-900"
        }`}
      >
        {value}
        {verified === true && (
          <Check className="w-3 h-3 text-emerald-600" aria-label="Verified at depot" />
        )}
        {verified === false && (
          <AlertTriangle
            className="w-3 h-3 text-amber-600"
            aria-label="Outside geofence or no location"
          />
        )}
        {valueNote && (
          <span className="text-[11px] text-gray-400 ml-1">({valueNote})</span>
        )}
      </span>
    </div>
  );
}
