import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { istDateString } from "@/lib/attendance/date";
import {
  istMinutesSinceMidnight,
  parseTimeToMin,
  shiftCalendarDate,
} from "@/lib/attendance/format";
import { deriveAdminUserStatus } from "@/lib/attendance/admin-status";
import {
  AttendanceDashboard,
  type RosterRow,
  type SerializedSummary,
  type SerializedRecord,
} from "@/components/admin/attendance/attendance-dashboard";

export const dynamic = "force-dynamic";

const DAYS_BACK_LIMIT = 365;

interface PageProps {
  searchParams: { date?: string | string[] };
}

export default async function AdminAttendancePage({ searchParams }: PageProps) {
  // Admin gating already enforced by app/(admin)/admin/layout.tsx via
  // requireRole(session, [ROLES.ADMIN]).

  const dateRaw = searchParams?.date;
  const dateParam = Array.isArray(dateRaw) ? dateRaw[0] : dateRaw;
  const today = istDateString();
  const viewedDate = parseAndClampDate(dateParam, today);
  const isToday = viewedDate === today;

  // Sequential awaits — never $transaction (Vercel pooler timeout rule).
  const settings = await prisma.attendance_settings.findFirst({
    where: { scope: "GLOBAL", roleSlug: null },
    select: {
      workStartTime: true,
      lateGraceMinutes: true,
      photoRetentionDays: true,
    },
  });
  if (!settings) redirect("/admin");

  const users = await prisma.users.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      attendanceTestUser: true,
      attendanceExempt: true,
      role: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });

  const summaries = await prisma.attendance_summary.findMany({
    where: { attendanceDate: viewedDate },
    select: {
      userId: true,
      status: true,
      totalMinutesWorked: true,
      overtimeMinutes: true,
      lateMinutes: true,
      firstCheckInAt: true,
      lastCheckOutAt: true,
      sessionCount: true,
      hasMissingCheckout: true,
      hasGeofenceViolation: true,
      hasManualEntries: true,
      exceptionReason: true,
    },
  });

  const otPendingCount = await prisma.attendance_records.count({
    where: { otApprovalStatus: "PENDING" },
  });

  const records = await prisma.attendance_records.findMany({
    where: { attendanceDate: viewedDate },
    orderBy: { timestamp: "asc" },
    select: {
      id: true,
      userId: true,
      type: true,
      timestamp: true,
      locationVerified: true,
      locationDistanceMeters: true,
      photoPath: true,
      hasNoLocation: true,
      isLate: true,
      isOvertime: true,
      isOutsideGeofence: true,
      isManualEntry: true,
      userAgent: true,
      deviceLabel: true,
      ipAddress: true,
      createdAt: true,
    },
  });

  // Yesterday-incomplete only for today's view (Q5c).
  let yesterdayIncompleteUserIds = new Set<number>();
  if (isToday) {
    const yesterday = shiftCalendarDate(viewedDate, 1);
    const yIncomplete = await prisma.attendance_summary.findMany({
      where: { attendanceDate: yesterday, hasMissingCheckout: true },
      select: { userId: true },
    });
    yesterdayIncompleteUserIds = new Set(yIncomplete.map((s) => s.userId));
  }

  // ── Per-user "This week" totals (Mon→viewedDate, qualifying status) ────────
  const weekStart = mondayOfWeek(viewedDate);
  const weekSummaryRows = await prisma.attendance_summary.findMany({
    where: {
      userId: { in: users.map((u) => u.id) },
      attendanceDate: { gte: weekStart, lte: viewedDate },
    },
    select: { userId: true, totalMinutesWorked: true, status: true },
  });
  const QUALIFYING = new Set(["PRESENT", "LATE", "HALF_DAY"]);
  const weekMinutesByUser = new Map<number, number>();
  for (const ws of weekSummaryRows) {
    if (!QUALIFYING.has(ws.status)) continue;
    weekMinutesByUser.set(
      ws.userId,
      (weekMinutesByUser.get(ws.userId) ?? 0) + ws.totalMinutesWorked,
    );
  }

  // ── Derive per-user roster rows ────────────────────────────────────────────
  const summariesByUser = new Map(summaries.map((s) => [s.userId, s]));
  const recordsByUser = new Map<number, typeof records>();
  for (const r of records) {
    const arr = recordsByUser.get(r.userId);
    if (arr) arr.push(r);
    else recordsByUser.set(r.userId, [r]);
  }

  const nowMinIST = istMinutesSinceMidnight();
  const workStartMin = parseTimeToMin(settings.workStartTime);
  const lateGraceMinutes = settings.lateGraceMinutes;

  const rosterRows: RosterRow[] = users.map((u) => {
    const summary = summariesByUser.get(u.id) ?? null;
    const userRecords = recordsByUser.get(u.id) ?? [];

    const status = deriveAdminUserStatus({
      attendanceExempt: u.attendanceExempt,
      summaryStatus: summary?.status ?? null,
      hasFirstCheckIn: summary?.firstCheckInAt != null,
      recordCount: userRecords.length,
      isToday,
      nowMinIST,
      workStartMin,
      lateGraceMinutes,
    });

    const serializedSummary: SerializedSummary | null = summary
      ? {
          userId: summary.userId,
          status: summary.status,
          totalMinutesWorked: summary.totalMinutesWorked,
          overtimeMinutes: summary.overtimeMinutes,
          lateMinutes: summary.lateMinutes,
          firstCheckInISO: summary.firstCheckInAt?.toISOString() ?? null,
          lastCheckOutISO: summary.lastCheckOutAt?.toISOString() ?? null,
          sessionCount: summary.sessionCount,
          hasMissingCheckout: summary.hasMissingCheckout,
          hasGeofenceViolation: summary.hasGeofenceViolation,
          hasManualEntries: summary.hasManualEntries,
          exceptionReason: summary.exceptionReason,
        }
      : null;

    const serializedRecords: SerializedRecord[] = userRecords.map((r) => ({
      id: r.id,
      userId: r.userId,
      type: r.type,
      timestampISO: r.timestamp.toISOString(),
      locationVerified: r.locationVerified,
      locationDistanceMeters: r.locationDistanceMeters,
      photoPath: r.photoPath,
      hasNoLocation: r.hasNoLocation,
      isLate: r.isLate,
      isOvertime: r.isOvertime,
      isOutsideGeofence: r.isOutsideGeofence,
      isManualEntry: r.isManualEntry,
      userAgent: r.userAgent,
      deviceLabel: r.deviceLabel,
      ipAddress: r.ipAddress,
      createdAtISO: r.createdAt.toISOString(),
    }));

    return {
      user: {
        id: u.id,
        name: u.name,
        role: u.role.name,
        attendanceTestUser: u.attendanceTestUser,
        attendanceExempt: u.attendanceExempt,
      },
      summary: serializedSummary,
      records: serializedRecords,
      status,
      flags: {
        geo: summary?.hasGeofenceViolation ?? false,
        manual: summary?.hasManualEntries ?? false,
        yesterday: yesterdayIncompleteUserIds.has(u.id),
      },
      thisWeekMinutes: weekMinutesByUser.get(u.id) ?? 0,
    };
  });

  return (
    <AttendanceDashboard
      viewedDate={viewedDate}
      today={today}
      rows={rosterRows}
      photoRetentionDays={settings.photoRetentionDays}
      otPendingCount={otPendingCount}
    />
  );
}

function parseAndClampDate(s: string | undefined, today: string): string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return today;
  if (s > today) return today;
  const minDate = shiftCalendarDate(today, DAYS_BACK_LIMIT);
  if (s < minDate) return minDate;
  return s;
}

function mondayOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utcDate = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  const dayOfWeek = utcDate.getUTCDay();      // 0=Sun, 6=Sat
  const daysFromMon = (dayOfWeek + 6) % 7;     // 0 if Mon
  return shiftCalendarDate(dateStr, daysFromMon);
}
