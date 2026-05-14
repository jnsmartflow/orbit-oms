"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { UniversalHeader } from "@/components/universal-header";
import { AdminSubNav } from "./admin-sub-nav";
import { RosterTable } from "./roster-table";
import { UserDetailPanel } from "./user-detail-panel";
import { triggerCsvExport } from "./export-button";
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
  rows,
  photoRetentionDays,
  otPendingCount,
}: AttendanceDashboardProps) {
  const router = useRouter();

  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSegment, setActiveSegment] = useState<SegmentId>("ALL");

  // ── Stats (computed from full roster — not affected by filters, per UI §6) ──
  // EXEMPT users excluded from stats math (Q5b). The Total denominator
  // counts only users we expect to attend.
  const stats = useMemo(() => {
    const expected = rows.filter((r) => r.status !== "EXEMPT");
    const inSet = new Set<AdminDisplayStatus>(["PRESENT", "LATE", "HALF_DAY", "INCOMPLETE"]);
    return {
      total: expected.length,
      inCount: expected.filter((r) => inSet.has(r.status)).length,
      lateCount: expected.filter((r) => r.status === "LATE").length,
      absentCount: expected.filter((r) => r.status === "ABSENT").length,
      pendingCount: expected.filter((r) => r.status === "NOT_IN_YET").length,
      flagsCount: expected.filter(
        (r) => r.flags.geo || r.flags.manual || r.flags.yesterday,
      ).length,
      presentCount: expected.filter((r) => r.status === "PRESENT").length,
    };
  }, [rows]);

  // ── Filter (search + segment) ──────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((row) => {
      if (q && !row.user.name.toLowerCase().includes(q)) return false;
      switch (activeSegment) {
        case "PRESENT":
          return row.status === "PRESENT";
        case "LATE":
          return row.status === "LATE";
        case "ABSENT":
          return row.status === "ABSENT";
        case "FLAGS":
          // Q5a: Flags = GEO | MANUAL | Y'DAY (LATE excluded — has its own segment)
          return row.flags.geo || row.flags.manual || row.flags.yesterday;
        case "ALL":
        default:
          return true;
      }
    });
  }, [rows, searchQuery, activeSegment]);

  // ── Date picker handler — URL-driven server re-render ──────────────────────
  const viewedDateObj = useMemo(() => {
    // Parse YYYY-MM-DD as IST midnight so the date picker shows the right day.
    return new Date(`${viewedDate}T00:00:00+05:30`);
  }, [viewedDate]);

  function handleDateChange(d: Date) {
    const istStr = d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    router.push(`/admin/attendance?date=${istStr}`);
  }

  function handleExport() {
    triggerCsvExport(viewedDate);
  }

  return (
    <div className="min-w-[1100px]">
      <UniversalHeader
        title={<span className="text-[14px] font-semibold text-gray-900">Attendance</span>}
        stats={[
          { label: "Total", value: stats.total },
          { label: "In", value: stats.inCount },
          { label: "Late", value: stats.lateCount },
          { label: "Absent", value: stats.absentCount },
          { label: "Not in yet", value: stats.pendingCount },
        ]}
        showDownload
        onDownload={handleExport}
        segments={[
          { id: "ALL", label: "All", count: stats.total },
          { id: "PRESENT", label: "Present", count: stats.presentCount },
          { id: "LATE", label: "Late", count: stats.lateCount },
          { id: "ABSENT", label: "Absent", count: stats.absentCount },
          { id: "FLAGS", label: "Flags", count: stats.flagsCount },
        ]}
        activeSegment={activeSegment}
        onSegmentChange={(id) => setActiveSegment((id as SegmentId) ?? "ALL")}
        searchPlaceholder="Search users…"
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        showDatePicker
        currentDate={viewedDateObj}
        onDateChange={handleDateChange}
      />

      <AdminSubNav active="dashboard" otPendingCount={otPendingCount} />

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
