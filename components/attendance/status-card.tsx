"use client";

import { useEffect, useState } from "react";
import { LiveTimer } from "./live-timer";
import {
  format24To12,
  formatDuration,
  formatIstClock,
  istMinutesSinceMidnight,
  parseTimeToMin,
} from "@/lib/attendance/format";
import type { AttendanceState } from "@/lib/attendance/state";

interface StatusCardProps {
  state: AttendanceState;
  workStartTime: string;
  workEndTime: string;
}

export function StatusCard({ state, workStartTime, workEndTime }: StatusCardProps) {
  if (state.kind === "WORKING") {
    return (
      <WorkingCard
        currentSessionStartISO={state.currentSessionStartISO}
        workStartTime={workStartTime}
        workEndTime={workEndTime}
      />
    );
  }
  return (
    <NotCheckedInCard
      lastCheckOutISO={state.lastCheckOutISO}
      todayMinutes={state.todayMinutes}
      workStartTime={workStartTime}
      workEndTime={workEndTime}
    />
  );
}

// ─────────────────────────────────────────────
// Card shell — gradient bg + dot pattern overlay (Q4)
// ─────────────────────────────────────────────

function CardShell({
  gradient,
  children,
}: {
  gradient: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`relative overflow-hidden rounded-2xl text-white shadow-sm ${gradient}`}>
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
      />
      <div className="relative px-5 py-6">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────
// State A / C — slate gradient
// ─────────────────────────────────────────────

interface NotCheckedInCardProps {
  lastCheckOutISO: string | null;
  todayMinutes: number;
  workStartTime: string;
  workEndTime: string;
}

function NotCheckedInCard({
  lastCheckOutISO,
  todayMinutes,
  workStartTime,
  workEndTime,
}: NotCheckedInCardProps) {
  return (
    <CardShell gradient="bg-gradient-to-br from-slate-800 to-slate-900">
      <p className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Status</p>
      <h2 className="text-[24px] font-semibold mb-1.5">Not Checked In</h2>
      {lastCheckOutISO ? (
        <p className="text-[14px] text-white/85 mb-4 tabular-nums">
          Last checked out {formatIstClock(lastCheckOutISO)} · {formatDuration(todayMinutes)} today
        </p>
      ) : (
        <p className="text-[14px] text-white/85 mb-4">Tap below to start your day</p>
      )}
      <div className="text-[12px] text-white/60 tabular-nums">
        Shift {format24To12(workStartTime)} – {format24To12(workEndTime)}
      </div>
    </CardShell>
  );
}

// ─────────────────────────────────────────────
// State B — teal gradient + live timer + progress bar
// ─────────────────────────────────────────────

interface WorkingCardProps {
  currentSessionStartISO: string;
  workStartTime: string;
  workEndTime: string;
}

const PROGRESS_TICK_MS = 30_000;

function WorkingCard({ currentSessionStartISO, workStartTime, workEndTime }: WorkingCardProps) {
  // Pre-mount null so SSR matches first client paint (no hydration
  // mismatch on the NOW dot position).
  const [nowMinIST, setNowMinIST] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNowMinIST(istMinutesSinceMidnight());
    tick();
    const id = setInterval(tick, PROGRESS_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const startMin = parseTimeToMin(workStartTime);
  const endMin = parseTimeToMin(workEndTime);

  // Cap at [0, 1] per Q7 — overtime doesn't extend the bar.
  let progressPct = 0;
  if (nowMinIST !== null && endMin > startMin) {
    progressPct = Math.max(0, Math.min(1, (nowMinIST - startMin) / (endMin - startMin)));
  }
  const progressPctStr = `${(progressPct * 100).toFixed(2)}%`;

  return (
    <CardShell gradient="bg-gradient-to-br from-teal-600 to-teal-700">
      <div className="flex items-center gap-2 mb-3">
        <span className="relative flex h-2 w-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full rounded-full bg-white/60 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
        </span>
        <p className="text-[11px] uppercase tracking-wider text-white/85">Currently working</p>
      </div>

      <div className="text-[44px] font-semibold tabular-nums leading-none mb-2">
        <LiveTimer startISO={currentSessionStartISO} />
      </div>
      <p className="text-[14px] text-white/85 mb-5 tabular-nums">
        Started {formatIstClock(currentSessionStartISO)}
      </p>

      <div className="flex items-center justify-between text-[11px] text-white/70 tabular-nums mb-1.5">
        <span>{format24To12(workStartTime)}</span>
        <span>{format24To12(workEndTime)}</span>
      </div>
      <div className="relative h-1.5 rounded-full bg-white/20">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-white transition-[width] duration-500"
          style={{ width: progressPctStr }}
        />
        {nowMinIST !== null && (
          <div
            className="absolute -top-1 -translate-x-1/2 h-3.5 w-3.5 rounded-full bg-white shadow-md transition-[left] duration-500"
            style={{ left: progressPctStr }}
            aria-hidden
          />
        )}
      </div>
    </CardShell>
  );
}
