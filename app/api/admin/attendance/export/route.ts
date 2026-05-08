import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { istDateString } from "@/lib/attendance/date";
import {
  formatDuration,
  formatIstClock,
  istMinutesSinceMidnight,
  parseTimeToMin,
  shiftCalendarDate,
} from "@/lib/attendance/format";
import { deriveAdminUserStatus } from "@/lib/attendance/admin-status";

export const dynamic = "force-dynamic";

const DAYS_BACK_LIMIT = 365;

const CSV_HEADERS = [
  "User",
  "Role",
  "Check In",
  "Check Out",
  "Worked",
  "Overtime",
  "Late",
  "Status",
  "Geofence OK",
  "Sessions",
  "Device",
  "IP",
];

// GET /api/admin/attendance/export?date=YYYY-MM-DD
//
// Admin-only. Streams a CSV with one row per active user for the
// requested date. Reuses lib/attendance/admin-status.ts so the export
// matches what the dashboard renders. Self-contained query: no shared
// fetch helper with the page route — keeps each endpoint independent.
export async function GET(req: Request) {
  const session = await auth();
  if (!hasRole(session, [ROLES.ADMIN])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const today = istDateString();
  const viewedDate = parseAndClampDate(dateParam, today);
  const isToday = viewedDate === today;

  // Sequential awaits — never $transaction (Vercel pooler timeout rule).
  const settings = await prisma.attendance_settings.findFirst({
    where: { scope: "GLOBAL", roleSlug: null },
    select: { workStartTime: true, lateGraceMinutes: true },
  });
  if (!settings) {
    return NextResponse.json(
      { error: "Attendance settings missing" },
      { status: 500 },
    );
  }

  const users = await prisma.users.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
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
      hasGeofenceViolation: true,
    },
  });

  const records = await prisma.attendance_records.findMany({
    where: { attendanceDate: viewedDate },
    orderBy: { timestamp: "asc" },
    select: {
      userId: true,
      type: true,
      timestamp: true,
      userAgent: true,
      deviceLabel: true,
      ipAddress: true,
    },
  });

  const summariesByUser = new Map(summaries.map((s) => [s.userId, s]));
  const recordsByUser = new Map<number, typeof records>();
  for (const r of records) {
    const arr = recordsByUser.get(r.userId);
    if (arr) arr.push(r);
    else recordsByUser.set(r.userId, [r]);
  }

  const nowMinIST = istMinutesSinceMidnight();
  const workStartMin = parseTimeToMin(settings.workStartTime);

  const lines: string[] = [CSV_HEADERS.map(escapeCsv).join(",")];
  for (const u of users) {
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
      lateGraceMinutes: settings.lateGraceMinutes,
    });

    const checkInDisplay = summary?.firstCheckInAt
      ? formatIstClock(summary.firstCheckInAt)
      : "—";
    const checkOutDisplay = summary?.lastCheckOutAt
      ? formatIstClock(summary.lastCheckOutAt)
      : "—";
    const workedDisplay =
      summary && summary.totalMinutesWorked > 0
        ? formatDuration(summary.totalMinutesWorked)
        : "—";
    const overtimeDisplay =
      summary && summary.overtimeMinutes > 0
        ? formatDuration(summary.overtimeMinutes)
        : "—";
    const lateDisplay =
      summary && summary.lateMinutes > 0 ? formatDuration(summary.lateMinutes) : "—";
    const geofenceDisplay = summary
      ? summary.hasGeofenceViolation
        ? "No"
        : "Yes"
      : "—";
    const sessionsDisplay = String(summary?.sessionCount ?? 0);

    // Latest record provides device + ip context for the export row.
    const latest = userRecords[userRecords.length - 1] ?? null;
    const device =
      latest?.deviceLabel ?? truncate(latest?.userAgent ?? "", 80);
    const ipAddress = latest?.ipAddress ?? "";

    const row = [
      u.name,
      formatRoleSlug(u.role.name),
      checkInDisplay,
      checkOutDisplay,
      workedDisplay,
      overtimeDisplay,
      lateDisplay,
      status,
      geofenceDisplay,
      sessionsDisplay,
      device,
      ipAddress,
    ];
    lines.push(row.map(escapeCsv).join(","));
  }

  const csv = lines.join("\r\n") + "\r\n";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="attendance-${viewedDate}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

function parseAndClampDate(s: string | null, today: string): string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return today;
  if (s > today) return today;
  const minDate = shiftCalendarDate(today, DAYS_BACK_LIMIT);
  if (s < minDate) return minDate;
  return s;
}

// RFC 4180-ish escape: wrap in quotes if the value contains comma,
// quote, CR, or LF; double-up internal quotes.
function escapeCsv(v: string): string {
  if (/[",\r\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function formatRoleSlug(slug: string): string {
  if (!slug) return "—";
  return slug
    .split(/[\s_]+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}
