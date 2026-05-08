"use client";

import { useState } from "react";
import { AlertTriangle, Camera, Check, MapPin } from "lucide-react";
import { PhotoViewer } from "./photo-viewer";
import { StatusChip } from "@/components/attendance/status-chip";
import { formatDuration, formatIstClock } from "@/lib/attendance/format";
import type { RosterRow } from "./attendance-dashboard";

interface UserDetailPanelProps {
  row: RosterRow | null;
  photoRetentionDays: number;
}

const istLongDateFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function UserDetailPanel({ row, photoRetentionDays }: UserDetailPanelProps) {
  if (!row) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-[12px] text-gray-400">
        Select a user from the table to see details
      </div>
    );
  }

  return <UserDetailPanelInner row={row} photoRetentionDays={photoRetentionDays} />;
}

function UserDetailPanelInner({
  row,
  photoRetentionDays,
}: {
  row: RosterRow;
  photoRetentionDays: number;
}) {
  const [stub, setStub] = useState<null | "edit" | "exception">(null);

  const { user, summary, records, status, flags } = row;

  // Latest record is what the photo card represents (most recent action).
  const latestRecord = records.length > 0 ? records[records.length - 1] : null;
  const lastIsOpenCheckIn = latestRecord?.type === "CHECK_IN";

  // Distance + verified flags come from the latest record.
  const distance = latestRecord?.locationDistanceMeters ?? null;
  const locationVerified = latestRecord?.locationVerified ?? null;

  const sessionsLabel = formatSessions(summary?.sessionCount ?? 0, lastIsOpenCheckIn);
  const deviceLabel = (latestRecord?.deviceLabel || latestRecord?.userAgent) ?? "—";
  const deviceLabelTrimmed = deviceLabel.length > 28 ? deviceLabel.slice(0, 28) + "…" : deviceLabel;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      {/* User block */}
      <header className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-full bg-teal-600 text-white flex items-center justify-center text-[14px] font-semibold shrink-0">
          {getInitials(user.name)}
        </div>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-gray-900 truncate">{user.name}</p>
          <p className="text-[12px] text-gray-500 truncate">{formatRoleSlug(user.role)}</p>
        </div>
        <div className="ml-auto">
          <StatusChip status={status} />
        </div>
      </header>

      {/* Photo card */}
      <div className="relative w-full aspect-[4/5] rounded-lg overflow-hidden bg-gray-100 mb-1">
        {latestRecord?.photoPath ? (
          <PhotoViewer recordId={latestRecord.id} />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[11px] text-gray-400">
            <Camera className="w-6 h-6" />
            No photo yet
          </div>
        )}
        {latestRecord && (
          <>
            <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/60 text-white text-[10px] font-medium tabular-nums">
              {formatIstClock(latestRecord.timestampISO)}
            </span>
            <VerifiedChip verified={locationVerified} distance={distance} />
          </>
        )}
      </div>
      {latestRecord && (
        <p className="text-[10px] text-gray-400 tabular-nums mb-4">
          Auto-deletes {formatRetentionDate(latestRecord.createdAtISO, photoRetentionDays)}
        </p>
      )}
      {!latestRecord && <div className="mb-4" />}

      {/* Detail rows */}
      <dl className="space-y-1.5 mb-4">
        <Row
          label="First check-in"
          value={summary?.firstCheckInISO ? formatIstClock(summary.firstCheckInISO) : "—"}
        />
        <Row
          label="Distance from depot"
          value={
            distance !== null ? (
              <DistanceBadge distance={distance} verified={locationVerified} />
            ) : (
              "—"
            )
          }
        />
        <Row label="Sessions" value={sessionsLabel} />
        <Row label="Device" value={deviceLabelTrimmed} title={deviceLabel} />
        <Row
          label="This week"
          value={
            row.thisWeekMinutes > 0 ? formatDuration(row.thisWeekMinutes) : "—"
          }
        />
        {summary?.exceptionReason && (
          <Row label="Note" value={summary.exceptionReason} />
        )}
        {flags.yesterday && (
          <Row
            label="Y'day"
            value={
              <span className="text-[11.5px] text-red-700 font-medium">
                Missing checkout
              </span>
            }
          />
        )}
      </dl>

      {/* Mini map placeholder — real map in Phase 2 */}
      <div
        className="relative h-[120px] rounded-lg mb-4 flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 border border-gray-200"
        aria-label="Map placeholder"
      >
        <MapPin className="w-6 h-6 text-gray-400" />
        <span className="absolute bottom-2 right-2 text-[9px] text-gray-400">Map · Phase 2</span>
      </div>

      {/* Action buttons (Phase 2 stubs per Q1) */}
      <div className="flex gap-2">
        <ActionButton onClick={() => setStub("edit")}>Edit Record</ActionButton>
        <ActionButton onClick={() => setStub("exception")}>Mark Exception</ActionButton>
      </div>

      {stub && <StubModal stub={stub} onClose={() => setStub(null)} />}
    </div>
  );
}

// ─────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────

function Row({
  label,
  value,
  title,
}: {
  label: string;
  value: React.ReactNode;
  title?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1 text-[12px]">
      <span className="text-gray-500">{label}</span>
      <span
        className="font-medium text-gray-900 tabular-nums truncate max-w-[200px]"
        title={title}
      >
        {value}
      </span>
    </div>
  );
}

function VerifiedChip({
  verified,
  distance,
}: {
  verified: boolean | null;
  distance: number | null;
}) {
  if (verified === null) {
    return (
      <span className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-700/80 text-white text-[10px] font-medium">
        No location
      </span>
    );
  }
  if (verified) {
    return (
      <span className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/90 text-white text-[10px] font-medium">
        <Check className="w-3 h-3" />
        DEPOT
      </span>
    );
  }
  return (
    <span className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/90 text-white text-[10px] font-medium tabular-nums">
      <AlertTriangle className="w-3 h-3" />
      {distance ?? "?"}m
    </span>
  );
}

function DistanceBadge({
  distance,
  verified,
}: {
  distance: number;
  verified: boolean | null;
}) {
  if (verified === null) {
    return <span className="text-gray-500 tabular-nums">{distance}m</span>;
  }
  if (verified) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700 tabular-nums">
        {distance}m <Check className="w-3 h-3" />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-amber-700 tabular-nums">
      {distance}m <AlertTriangle className="w-3 h-3" />
    </span>
  );
}

function ActionButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 h-9 rounded-md border border-gray-200 hover:bg-gray-50 text-[12.5px] text-gray-700 font-medium transition-colors"
    >
      {children}
    </button>
  );
}

function StubModal({ stub, onClose }: { stub: "edit" | "exception"; onClose: () => void }) {
  const title = stub === "edit" ? "Edit Record" : "Mark Exception";
  const body =
    stub === "edit"
      ? "Manual record entry and editing will land in Phase 2."
      : "Exception management (mark as ON_LEAVE / HOLIDAY with reason) will land in Phase 2.";
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[400px] bg-white rounded-lg shadow-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[15px] font-semibold text-gray-900 mb-2">{title}</h3>
        <p className="text-[13px] text-gray-600 leading-relaxed mb-4">{body}</p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-md bg-gray-900 hover:bg-gray-800 text-white text-[13px] font-semibold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function formatRoleSlug(slug: string): string {
  if (!slug) return "—";
  return slug
    .split(/[\s_]+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

function formatSessions(count: number, isActive: boolean): string {
  if (count === 0 && !isActive) return "0";
  if (isActive) {
    // sessionCount counts completed sessions; an open CHECK_IN means
    // the active session isn't counted yet.
    const completed = count;
    const total = count + 1;
    return `${total} (active${completed > 0 ? `, ${completed} done` : ""})`;
  }
  return String(count);
}

function formatRetentionDate(createdAtISO: string, days: number): string {
  const d = new Date(createdAtISO);
  const expiry = new Date(d.getTime() + days * 86_400_000);
  return istLongDateFormatter.format(expiry);
}
